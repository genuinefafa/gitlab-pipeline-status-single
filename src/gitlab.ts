import axios, { AxiosInstance } from 'axios';
import { Project, Branch, Pipeline, ProjectConfig, GroupConfig } from './types';

export class GitLabClient {
  private client: AxiosInstance;

  constructor(baseURL: string, token: string) {
    this.client = axios.create({
      baseURL: `${baseURL}/api/v4`,
      headers: {
        'PRIVATE-TOKEN': token,
      },
      timeout: 10000,
    });
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
            pipeline: pipeline || undefined,
          };
        } catch (error) {
          return {
            name: branch.name,
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
