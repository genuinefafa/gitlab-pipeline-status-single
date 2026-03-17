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
    console.log(`[Poller] Iniciando con intervalo de ${this.intervalMs}ms`);
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
    console.log('[Poller] Detenido');
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
        console.error('[Poller] Error inesperado en el loop:', error);
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
      return; // Nada que pollear
    }

    // Cache de clientes GitLab por servidor para reutilizar conexiones
    const clientCache = new Map<string, GitLabClient>();

    for (const [branchKey] of watched) {
      try {
        await this.pollBranch(branchKey, clientCache);
      } catch (error) {
        // Loguear pero continuar con la siguiente branch
        console.error(`[Poller] Error polleando ${branchKey}:`, error);
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
      console.warn(`[Poller] branchKey inválida: ${branchKey}`);
      return;
    }

    const { projectPath, branchName } = parsed;

    // Resolver servidor
    const serverInfo = resolveServer(projectPath);
    if (!serverInfo) {
      console.warn(`[Poller] No se encontró servidor para: ${projectPath}`);
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
        console.error(`[Poller] No se pudo crear cliente para ${serverName}:`, error);
        return;
      }
    }

    // Resolver projectId desde el cache L1
    const projectId = resolveProjectId(projectPath);
    if (!projectId) {
      console.warn(`[Poller] No se encontró projectId para ${projectPath} en cache L1`);
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
        this.lastStatus.delete(branchKey);
        return;
      }

      console.error(`[Poller] Error consultando pipeline de ${branchKey}:`, (error as Error).message);
      return;
    }

    // Comparar con el estado anterior
    if (this.hasChanged(branchKey, pipeline)) {
      this.sseManager.pushToBranch(branchKey, {
        type: 'pipeline-update',
        data: {
          branch: branchKey,
          pipeline,
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

  /**
   * Detectar si el estado de un pipeline cambió respecto a la última vez.
   */
  private hasChanged(branchKey: string, pipeline: Pipeline | null): boolean {
    const prev = this.lastStatus.get(branchKey);

    if (!prev && !pipeline) return false;
    if (!prev || !pipeline) return true;

    return prev.status !== pipeline.status || prev.pipelineId !== pipeline.id;
  }
}
