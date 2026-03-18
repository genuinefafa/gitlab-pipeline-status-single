/**
 * GitLab Poller — Loop centralizado que consulta GitLab por cambios en pipelines
 * y notifica a los clientes SSE cuando detecta actualizaciones.
 *
 * Es robusto: nunca crashea, loguea errores y continúa con la siguiente branch.
 */

import type { Pipeline, Project } from './types.ts';
import { GitLabClient, GitLabApiError } from './gitlab.ts';
import { config } from './config.ts';
import { SSEManager } from './sse-manager.ts';
import { projectsCache } from './cache.ts';
import { tokenManager } from './routes/api.ts';
import { log } from './logger.ts';

interface LastPipelineState {
  status: string;
  pipelineId: number | null;
}

/**
 * Obtener un token usable para un servidor dado.
 * Usa el TokenManager compartido de routes/api.ts
 */
function getServerToken(serverName: string): string {
  const server = config.servers.find((s) => s.name === serverName);
  if (!server) throw new Error(`Servidor ${serverName} no encontrado en la config`);

  const validated = tokenManager.getValidToken(serverName);
  if (validated) return validated;

  if (server.token) return server.token;
  if (server.tokens?.length) return server.tokens[0].value;

  throw new Error(`No hay tokens disponibles para ${serverName}`);
}

/**
 * Resolver el projectId numérico desde el cache L1.
 */
function resolveProjectId(projectPath: string): number | null {
  for (const server of config.servers) {
    const cacheKey = `server:${server.name}`;
    const cached = projectsCache.get(cacheKey);
    if (cached.data) {
      const projects = cached.data as Project[];
      const project = projects.find(p => p.path_with_namespace === projectPath);
      if (project) return project.id;
    }
  }
  return null;
}

/**
 * Parsear una branchKey con formato "proyecto/path:rama" para extraer
 * el path del proyecto y el nombre de la rama.
 *
 * Formato: "grupo/proyecto:rama" donde rama puede contener "/"
 * El separador es el primer ":" encontrado.
 */
function parseBranchKey(branchKey: string): { projectPath: string; branchName: string } | null {
  const separatorIndex = branchKey.indexOf(':');
  if (separatorIndex === -1) return null;

  const projectPath = branchKey.substring(0, separatorIndex);
  const branchName = branchKey.substring(separatorIndex + 1);

  if (!projectPath || !branchName) return null;

  return { projectPath, branchName };
}

/**
 * Resolver en qué servidor está un proyecto dado su path.
 * Busca en la config cuál servidor tiene configurado ese proyecto o grupo.
 */
function resolveServer(projectPath: string): { serverName: string; serverUrl: string } | null {
  for (const server of config.servers) {
    // Buscar en proyectos configurados directamente
    if (server.projects?.some((p) => p.path === projectPath)) {
      return { serverName: server.name, serverUrl: server.url };
    }

    // Buscar en grupos: si el proyecto empieza con el path del grupo
    if (server.groups?.some((g) => g.path && projectPath.startsWith(g.path))) {
      return { serverName: server.name, serverUrl: server.url };
    }
  }

  // Si hay un solo servidor, asumir que es ese
  if (config.servers.length === 1) {
    const server = config.servers[0];
    return { serverName: server.name, serverUrl: server.url };
  }

  return null;
}

export class GitLabPoller {
  private _running = false;
  private lastStatus = new Map<string, LastPipelineState>();
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private cycleCount = 0;
  // Cada cuántos ciclos refrescar branches/MRs (10 × 30s = 5min)
  private branchRefreshEvery = 10;

  constructor(
    private sseManager: SSEManager,
    private intervalMs: number = 30000
  ) {}

  /**
   * Indica si el poller está corriendo.
   */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * Arrancar el loop de polling.
   * Si ya está corriendo, no hace nada.
   */
  start(): void {
    if (this._running) return;
    this._running = true;
    log.info('Poller', ` Iniciando con intervalo de ${this.intervalMs}ms`);
    this.loop();
  }

  /**
   * Detener el loop de polling.
   */
  stop(): void {
    this._running = false;
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
    log.info('Poller', 'Detenido');
  }

  /**
   * Loop principal: ejecuta pollOnce y espera el intervalo.
   * Nunca crashea — atrapa todo.
   */
  private async loop(): Promise<void> {
    while (this._running) {
      try {
        await this.pollOnce();
      } catch (error) {
        log.error('Poller', ' Error inesperado en el loop:', error);
      }

      // Esperar el intervalo usando Bun.sleep si está disponible, sino setTimeout
      if (this._running) {
        await Bun.sleep(this.intervalMs);
      }
    }
  }

  /**
   * Un ciclo de polling: consulta todas las branches con suscriptores
   * y pushea cambios via SSE.
   */
  async pollOnce(): Promise<void> {
    const watched = this.sseManager.getWatchedBranches();

    if (watched.size === 0) {
      return;
    }

    this.cycleCount++;
    const clientCache = new Map<string, GitLabClient>();

    // Cada N ciclos, refrescar lista de branches + MRs por proyecto
    if (this.cycleCount % this.branchRefreshEvery === 0) {
      await this.refreshBranches(watched, clientCache);
    }

    // Siempre: pollear status de pipelines
    for (const [branchKey] of watched) {
      try {
        await this.pollBranch(branchKey, clientCache);
      } catch (error) {
        log.error('Poller', ` Error polleando ${branchKey}:`, error);
      }
    }
  }

  /**
   * Refrescar branches y MRs de los proyectos que tienen suscriptores.
   * Detecta branches borrados, nuevos, y cambios en aprobaciones.
   */
  private async refreshBranches(
    watched: Map<string, Set<string>>,
    clientCache: Map<string, GitLabClient>
  ): Promise<void> {
    // Agrupar branchKeys por proyecto
    const projectPaths = new Set<string>();
    for (const [branchKey] of watched) {
      const parsed = parseBranchKey(branchKey);
      if (parsed) projectPaths.add(parsed.projectPath);
    }

    for (const projectPath of projectPaths) {
      try {
        const serverInfo = resolveServer(projectPath);
        if (!serverInfo) continue;

        const projectId = resolveProjectId(projectPath);
        if (!projectId) continue;

        let client = clientCache.get(serverInfo.serverName);
        if (!client) {
          const token = getServerToken(serverInfo.serverName);
          client = new GitLabClient(serverInfo.serverUrl, token);
          clientCache.set(serverInfo.serverName, client);
        }

        // Fetch branches actuales
        const gitlabBranches = await client.getBranches(projectId);
        const currentBranchNames = new Set(gitlabBranches.map(b => b.name));

        // Detectar branches borrados
        for (const [branchKey] of watched) {
          const parsed = parseBranchKey(branchKey);
          if (!parsed || parsed.projectPath !== projectPath) continue;
          if (!currentBranchNames.has(parsed.branchName)) {
            log.info('Poller', ` Branch borrado: ${branchKey}`);
            this.sseManager.pushToBranch(branchKey, {
              type: 'branch-deleted',
              data: { branch: branchKey },
            });
            this.sseManager.unsubscribeAll(branchKey);
            this.lastStatus.delete(branchKey);
          }
        }

        // Construir datos de branches con MRs y approvals
        const branchData = gitlabBranches.map(b => ({
          name: b.name,
          commitTitle: b.commit.title,
          commitShortId: b.commit.short_id,
          committedDate: b.commit.committed_date,
          mergeRequest: undefined as any,
        }));

        // Buscar MRs + approvals en paralelo
        const mrPromises = branchData
          .filter(b => b.name !== 'master' && b.name !== 'main')
          .map(async (b) => {
            const mrs = await client!.getMergeRequestsByBranch(projectId!, b.name);
            if (mrs.length > 0) {
              const mr = mrs[0];
              const approvals = await client!.getMergeRequestApprovals(projectId!, mr.iid);
              b.mergeRequest = {
                iid: mr.iid,
                title: mr.title,
                url: mr.web_url,
                targetBranch: mr.target_branch,
                approved: approvals.approved,
                approvedBy: approvals.approved_by.map(a => a.user.name),
                approvalsRequired: approvals.approvals_required,
                approvalsLeft: approvals.approvals_left,
              };
            }
          });
        await Promise.all(mrPromises);

        // Ordenar: master/main primero, luego por fecha desc
        branchData.sort((a, b) => {
          if (a.name === 'master' || a.name === 'main') return -1;
          if (b.name === 'master' || b.name === 'main') return 1;
          return new Date(b.committedDate).getTime() - new Date(a.committedDate).getTime();
        });

        // Pushear actualización de branches a todos los que miran este proyecto
        this.sseManager.broadcast({
          type: 'branches-updated',
          data: { projectPath, branches: branchData },
        });

        log.info('Poller', ` Branches refrescados para ${projectPath}: ${branchData.length} ramas`);
      } catch (error) {
        log.error('Poller', ` Error refrescando branches de ${projectPath}:`, (error as Error).message);
      }
    }
  }

  /**
   * Pollear una branch específica.
   */
  private async pollBranch(
    branchKey: string,
    clientCache: Map<string, GitLabClient>
  ): Promise<void> {
    const parsed = parseBranchKey(branchKey);
    if (!parsed) {
      log.warn('Poller', ` branchKey inválida: ${branchKey}`);
      return;
    }

    const { projectPath, branchName } = parsed;

    // Resolver servidor
    const serverInfo = resolveServer(projectPath);
    if (!serverInfo) {
      log.warn('Poller', ` No se encontró servidor para: ${projectPath}`);
      return;
    }

    const { serverName, serverUrl } = serverInfo;

    // Obtener o crear cliente GitLab
    let client = clientCache.get(serverName);
    if (!client) {
      try {
        const token = getServerToken(serverName);
        client = new GitLabClient(serverUrl, token);
        clientCache.set(serverName, client);
      } catch (error) {
        log.error('Poller', ` No se pudo crear cliente para ${serverName}:`, error);
        return;
      }
    }

    // Resolver projectId desde el cache L1
    const projectId = resolveProjectId(projectPath);
    if (!projectId) {
      log.warn('Poller', ` No se encontró projectId para ${projectPath} en cache L1`);
      return;
    }

    // Consultar el pipeline más reciente
    let pipeline: Pipeline | null = null;
    try {
      pipeline = await client.getLatestPipeline(projectId, branchName);
    } catch (error: unknown) {
      // Si es 404, la branch fue borrada
      if (error instanceof GitLabApiError && error.status === 404) {
        this.sseManager.pushToBranch(branchKey, {
          type: 'branch-deleted',
          data: { branch: branchKey },
        });
        this.sseManager.unsubscribeAll(branchKey);
        this.lastStatus.delete(branchKey);
        return;
      }

      log.error('Poller', ` Error consultando pipeline de ${branchKey}:`, (error as Error).message);
      return;
    }

    // Si hay pipeline, obtener los jobs
    let jobs: import('./types.ts').PipelineJob[] | undefined;
    if (pipeline) {
      try {
        const rawJobs = await client.getPipelineJobs(projectId, pipeline.id);
        rawJobs.reverse(); // GitLab los devuelve en orden inverso
        jobs = rawJobs;
      } catch (error) {
        log.error('Poller', ` Error obteniendo jobs de pipeline ${pipeline.id}:`, (error as Error).message);
      }
    }

    // Obtener título del commit del pipeline
    let commitTitle: string | null = null;
    if (pipeline) {
      try {
        commitTitle = await client.getCommitTitle(projectId, pipeline.sha);
      } catch { /* no crítico */ }
    }

    // Siempre pushear el estado actual — Preact se encarga de no re-renderizar si no cambió.
    this.sseManager.pushToBranch(branchKey, {
      type: 'pipeline-update',
      data: {
        branch: branchKey,
        pipeline: pipeline ? { ...pipeline, jobs, commit_title: commitTitle } : null,
      },
    });

    // Actualizar lastStatus
    if (pipeline) {
      this.lastStatus.set(branchKey, {
        status: pipeline.status,
        pipelineId: pipeline.id,
      });
    } else {
      this.lastStatus.delete(branchKey);
    }
  }

}
