import axios, { AxiosInstance } from 'axios';
import { Project, Branch, Pipeline, ProjectConfig, GroupConfig, TokenInfo } from './types';

export class GitLabClient {
  private client: AxiosInstance;
  private baseURL: string;
  private currentToken: string;

  constructor(baseURL: string, token: string) {
    this.baseURL = baseURL;
    this.currentToken = token;
    this.client = axios.create({
      baseURL: `${baseURL}/api/v4`,
      headers: {
        'PRIVATE-TOKEN': token,
      },
      timeout: 10000,
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use((config) => {
      const url = `${config.baseURL}${config.url}`;
      console.log(`  → ${config.method?.toUpperCase()} ${url}`);
      return config;
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`  ← ${response.status} ${response.statusText} (${response.data?.length || 'N/A'} items)`);
        return response;
      },
      (error) => {
        if (axios.isAxiosError(error)) {
          console.error(`  ← ${error.response?.status || 'ERR'} ${error.response?.statusText || error.message}`);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Update the token used by this client
   */
  setToken(token: string): void {
    this.currentToken = token;
    this.client.defaults.headers['PRIVATE-TOKEN'] = token;
  }

  /**
   * Get current token information from GitLab
   */
  async getTokenInfo(): Promise<TokenInfo> {
    try {
      const response = await this.client.get<TokenInfo>('/personal_access_tokens/self');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch token info: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getProject(config: ProjectConfig): Promise<Project> {
    try {
      const endpoint = config.id
        ? `/projects/${config.id}`
        : `/projects/${encodeURIComponent(config.path!)}`;

      const response = await this.client.get<Project>(endpoint);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch project: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getBranches(projectId: number): Promise<Branch[]> {
    try {
      const response = await this.client.get<Branch[]>(
        `/projects/${projectId}/repository/branches`
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch branches: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getLatestPipeline(
    projectId: number,
    branchName: string
  ): Promise<Pipeline | null> {
    try {
      const response = await this.client.get<Pipeline[]>(
        `/projects/${projectId}/pipelines`,
        {
          params: {
            ref: branchName,
            per_page: 1,
            order_by: 'updated_at',
            sort: 'desc',
          },
        }
      );

      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // 403 might mean pipelines are disabled
        if (error.response?.status === 403) {
          return null;
        }
        throw new Error(
          `Failed to fetch pipeline: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  /**
   * Get last N pipelines for a branch (for statistics/estimation)
   * Excludes canceled and skipped pipelines as they don't represent normal execution time
   */
  async getRecentPipelines(
    projectId: number,
    branchName: string,
    count: number = 10
  ): Promise<Pipeline[]> {
    try {
      const response = await this.client.get<Pipeline[]>(
        `/projects/${projectId}/pipelines`,
        {
          params: {
            ref: branchName,
            per_page: count * 2, // Fetch extra to account for filtering
            order_by: 'updated_at',
            sort: 'desc',
          },
        }
      );

      // Filter out canceled/skipped and keep only finished pipelines with duration
      const validPipelines = response.data
        .filter(
          (p) =>
            p.status !== 'canceled' &&
            p.status !== 'skipped' &&
            p.duration !== null &&
            p.duration > 0
        )
        .slice(0, count); // Take only the requested count after filtering

      return validPipelines;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          return [];
        }
        throw new Error(
          `Failed to fetch recent pipelines: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getPipelineJobs(projectId: number, pipelineId: number) {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/pipelines/${pipelineId}/jobs`
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          return [];
        }
        throw new Error(
          `Failed to fetch pipeline jobs: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getGroupProjects(config: GroupConfig): Promise<Project[]> {
    try {
      const endpoint = config.id
        ? `/groups/${config.id}/projects`
        : `/groups/${encodeURIComponent(config.path!)}/projects`;

      const params: any = {
        per_page: 100,
        simple: false,
        order_by: 'name',
        sort: 'asc',
      };

      if (config.includeSubgroups) {
        params.include_subgroups = true;
      }

      // GitLab API may paginate results, fetch all pages
      const allProjects: Project[] = [];
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const response = await this.client.get<Project[]>(endpoint, {
          params: { ...params, page },
        });

        allProjects.push(...response.data);

        // Check if there are more pages
        const totalPages = response.headers['x-total-pages'];
        hasMorePages = totalPages && page < parseInt(totalPages, 10);
        page++;
      }

      return allProjects;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch group projects: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getProjectPipelineData(config: ProjectConfig) {
    const project = await this.getProject(config);
    const branches = await this.getBranches(project.id);

    const branchesWithPipelines = await Promise.all(
      branches.map(async (branch) => {
        try {
          const pipeline = await this.getLatestPipeline(project.id, branch.name);
          return {
            name: branch.name,
            commitTitle: branch.commit.title,
            commitShortId: branch.commit.short_id,
            pipeline: pipeline || undefined,
          };
        } catch (error) {
          return {
            name: branch.name,
            commitTitle: branch.commit.title,
            commitShortId: branch.commit.short_id,
            error: (error as Error).message,
          };
        }
      })
    );

    return {
      project,
      branches: branchesWithPipelines,
    };
  }
}
