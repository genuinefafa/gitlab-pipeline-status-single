import { Project, Branch, Pipeline, ProjectConfig, GroupConfig, TokenInfo, PipelineJob, MergeRequest, MergeRequestApproval } from './types.ts';

export class GitLabClient {
  private apiBase: string;
  private token: string;

  constructor(baseURL: string, token: string) {
    this.apiBase = `${baseURL}/api/v4`;
    this.token = token;
  }

  /** Actualizar el token del cliente */
  setToken(token: string): void {
    this.token = token;
  }

  /** Hacer un request autenticado a la API de GitLab */
  private async request<T>(path: string, params?: Record<string, string | number | boolean>): Promise<{ data: T; headers: Headers }> {
    const url = new URL(`${this.apiBase}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString(), {
      headers: { 'PRIVATE-TOKEN': this.token },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const statusText = response.statusText || `HTTP ${response.status}`;
      throw new GitLabApiError(
        `GitLab API error: ${response.status} ${statusText} - ${path}`,
        response.status
      );
    }

    const data = await response.json() as T;
    return { data, headers: response.headers };
  }

  /** Información del token actual */
  async getTokenInfo(): Promise<TokenInfo> {
    const { data } = await this.request<TokenInfo>('/personal_access_tokens/self');
    return data;
  }

  /** Obtener un proyecto por config (id o path) */
  async getProject(config: ProjectConfig): Promise<Project> {
    const endpoint = config.id
      ? `/projects/${config.id}`
      : `/projects/${encodeURIComponent(config.path!)}`;

    const { data } = await this.request<Project>(endpoint);
    return data;
  }

  /** Obtener ramas de un proyecto */
  async getBranches(projectId: number): Promise<Branch[]> {
    const { data } = await this.request<Branch[]>(
      `/projects/${projectId}/repository/branches`
    );
    return data;
  }

  /** Obtener el último pipeline de una rama */
  async getLatestPipeline(projectId: number, branchName: string): Promise<Pipeline | null> {
    try {
      const { data: pipelines } = await this.request<Pipeline[]>(
        `/projects/${projectId}/pipelines`,
        {
          ref: branchName,
          per_page: 1,
          order_by: 'updated_at',
          sort: 'desc',
        }
      );

      if (pipelines.length === 0) {
        return null;
      }

      const pipeline = pipelines[0];

      // Si faltan campos de duración, buscar detalles completos
      if (pipeline.duration === undefined || pipeline.started_at === undefined) {
        try {
          const { data: details } = await this.request<Pipeline>(
            `/projects/${projectId}/pipelines/${pipeline.id}`
          );
          return details;
        } catch {
          // Si falla el detalle, devolver lo que tenemos
          return pipeline;
        }
      }

      return pipeline;
    } catch (error) {
      // 403 puede significar que pipelines están deshabilitados
      if (error instanceof GitLabApiError && error.status === 403) {
        return null;
      }
      throw error;
    }
  }

  /** Obtener jobs de un pipeline */
  async getPipelineJobs(projectId: number, pipelineId: number): Promise<PipelineJob[]> {
    try {
      const { data } = await this.request<PipelineJob[]>(
        `/projects/${projectId}/pipelines/${pipelineId}/jobs`
      );
      return data;
    } catch (error) {
      if (error instanceof GitLabApiError && error.status === 403) {
        return [];
      }
      throw error;
    }
  }

  /** Obtener merge requests abiertas asociadas a una rama */
  async getMergeRequestsByBranch(projectId: number, branchName: string): Promise<MergeRequest[]> {
    try {
      const { data } = await this.request<MergeRequest[]>(
        `/projects/${projectId}/merge_requests`,
        {
          source_branch: branchName,
          state: 'opened',
          per_page: 1,
          order_by: 'updated_at',
          sort: 'desc',
        }
      );
      return data;
    } catch {
      return [];
    }
  }

  /** Obtener estado de aprobación de un merge request */
  async getMergeRequestApprovals(projectId: number, mrIid: number): Promise<MergeRequestApproval> {
    try {
      const { data } = await this.request<MergeRequestApproval>(
        `/projects/${projectId}/merge_requests/${mrIid}/approvals`
      );
      return data;
    } catch {
      return { approved: false, approved_by: [], approvals_required: 0, approvals_left: 0 };
    }
  }

  /** Obtener todos los proyectos de un grupo, con paginación */
  async getGroupProjects(config: GroupConfig): Promise<Project[]> {
    const endpoint = config.id
      ? `/groups/${config.id}/projects`
      : `/groups/${encodeURIComponent(config.path!)}/projects`;

    const baseParams: Record<string, string | number | boolean> = {
      per_page: 100,
      simple: false,
      order_by: 'name',
      sort: 'asc',
    };

    if (config.includeSubgroups) {
      baseParams.include_subgroups = true;
    }

    const allProjects: Project[] = [];
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const { data, headers } = await this.request<Project[]>(endpoint, {
        ...baseParams,
        page,
      });

      allProjects.push(...data);

      const totalPages = headers.get('x-total-pages');
      hasMorePages = !!totalPages && page < parseInt(totalPages, 10);
      page++;
    }

    return allProjects;
  }
}

/** Error específico de la API de GitLab con status code */
export class GitLabApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'GitLabApiError';
  }
}
