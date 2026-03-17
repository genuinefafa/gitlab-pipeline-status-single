import { Hono } from 'hono';
import { config } from '../config.ts';
import { GitLabClient } from '../gitlab.ts';
import { TokenManager } from '../token-manager.ts';
import { projectsCache, branchesCache, pipelinesCache } from '../cache.ts';
import type { Project, ProjectConfig, GitLabServer } from '../types.ts';

const api = new Hono();

// TokenManager compartido
export const tokenManager = new TokenManager();

// --- Helpers ---

/** Obtener token válido para un servidor (TokenManager primero, fallback a config) */
function getServerToken(serverName: string): string {
  const server = config.servers.find(s => s.name === serverName);
  if (!server) {
    throw new Error(`Servidor ${serverName} no encontrado en la configuración`);
  }

  // Intentar token validado del TokenManager
  const validatedToken = tokenManager.getValidToken(serverName);
  if (validatedToken) {
    return validatedToken;
  }

  // Fallback a config
  if (server.token) {
    return server.token;
  }
  if (server.tokens && server.tokens.length > 0) {
    return server.tokens[0].value;
  }

  throw new Error(`No hay tokens válidos configurados para el servidor ${serverName}`);
}

/** Verificar si un proyecto debe excluirse */
function isProjectExcluded(projectName: string, projectPath: string): boolean {
  if (!config.excludeProjects || config.excludeProjects.length === 0) {
    return false;
  }

  const nameLower = projectName.toLowerCase();
  const pathLower = projectPath.toLowerCase();

  return config.excludeProjects.some((excludePattern) => {
    const patternLower = excludePattern.toLowerCase();
    return nameLower.includes(patternLower) || pathLower.includes(patternLower);
  });
}

/** Encontrar el servidor y proyecto que matchea un projectPath */
function findServerForProject(projectPath: string): { server: GitLabServer; project: Project } | null {
  // Buscar en el cache L1 de proyectos
  for (const server of config.servers) {
    const cacheKey = `server:${server.name}`;
    const cached = projectsCache.get(cacheKey);
    if (cached.data) {
      const projects = cached.data as Project[];
      const project = projects.find(p => p.path_with_namespace === projectPath);
      if (project) {
        return { server, project };
      }
    }
  }
  return null;
}

// --- Rutas ---

/**
 * GET /api/projects
 * Lista todos los proyectos de todos los servidores configurados.
 * Usa L1 cache (30min).
 */
api.get('/api/projects', async (c) => {
  try {
    const servers = [];

    for (const server of config.servers) {
      const cacheKey = `server:${server.name}`;
      const cached = projectsCache.get(cacheKey);

      if (cached.data && !cached.isStale) {
        const projects = (cached.data as Project[]).filter(
          p => !isProjectExcluded(p.name, p.path_with_namespace)
        );
        servers.push({
          name: server.name,
          projects: projects.map(p => ({
            id: p.id,
            name: p.name,
            path: p.path_with_namespace,
            url: p.web_url,
          })),
        });
        continue;
      }

      // Fetch fresh
      const client = new GitLabClient(server.url, getServerToken(server.name));
      const allProjects: Project[] = [];

      // Proyectos individuales
      if (server.projects && server.projects.length > 0) {
        for (const projConfig of server.projects) {
          try {
            const project = await client.getProject(projConfig);
            allProjects.push(project);
          } catch (error) {
            console.error(`Error al obtener proyecto ${projConfig.path || projConfig.id}:`, (error as Error).message);
          }
        }
      }

      // Grupos
      if (server.groups && server.groups.length > 0) {
        for (const groupConfig of server.groups) {
          try {
            const groupProjects = await client.getGroupProjects(groupConfig);
            allProjects.push(...groupProjects);
          } catch (error) {
            console.error(`Error al obtener grupo ${groupConfig.path || groupConfig.id}:`, (error as Error).message);
          }
        }
      }

      // Guardar en cache L1
      projectsCache.set(cacheKey, allProjects);

      const filtered = allProjects.filter(
        p => !isProjectExcluded(p.name, p.path_with_namespace)
      );

      servers.push({
        name: server.name,
        projects: filtered.map(p => ({
          id: p.id,
          name: p.name,
          path: p.path_with_namespace,
          url: p.web_url,
        })),
      });
    }

    return c.json({ servers });
  } catch (error) {
    console.error('Error en /api/projects:', (error as Error).message);
    return c.json({ error: 'Error al obtener proyectos', message: (error as Error).message }, 500);
  }
});

/**
 * GET /api/projects/:projectPath
 * Ramas de un proyecto. Usa L2 cache (5min).
 * El projectPath puede tener slashes (grupo/subgrupo/proyecto).
 */
api.get('/api/projects/:projectPath{.+}/branches', async (c) => {
  try {
    const projectPath = c.req.param('projectPath');
    const cacheKey = `branches:${projectPath}`;
    const cached = branchesCache.get(cacheKey);

    if (cached.data && !cached.isStale) {
      return c.json({ branches: cached.data });
    }

    // Buscar servidor y proyecto
    const match = findServerForProject(projectPath);
    let projectId: number;
    let serverUrl: string;
    let serverName: string;

    if (match) {
      projectId = match.project.id;
      serverUrl = match.server.url;
      serverName = match.server.name;
    } else {
      // Si no está en cache, buscar en todos los servidores
      let found = false;
      for (const server of config.servers) {
        try {
          const client = new GitLabClient(server.url, getServerToken(server.name));
          const project = await client.getProject({ path: projectPath });
          projectId = project.id;
          serverUrl = server.url;
          serverName = server.name;
          found = true;
          break;
        } catch {
          continue;
        }
      }
      if (!found) {
        return c.json({ error: `Proyecto no encontrado: ${projectPath}` }, 404);
      }
    }

    const client = new GitLabClient(serverUrl!, getServerToken(serverName!));
    const branches = await client.getBranches(projectId!);

    const branchData = branches.map(b => ({
      name: b.name,
      commitTitle: b.commit.title,
      commitShortId: b.commit.short_id,
    }));

    branchesCache.set(cacheKey, branchData);
    return c.json({ branches: branchData });
  } catch (error) {
    console.error('Error en /api/projects/.../branches:', (error as Error).message);
    return c.json({ error: 'Error al obtener ramas', message: (error as Error).message }, 500);
  }
});

/**
 * GET /api/status?branches=grupo/proj/main,grupo/proj/dev
 * Status batched de pipelines. Usa L3 cache (30s).
 * Cada key es "projectPath/branchName".
 */
api.get('/api/status', async (c) => {
  try {
    const branchesParam = c.req.query('branches');
    if (!branchesParam) {
      return c.json({ error: 'Parámetro "branches" requerido' }, 400);
    }

    const branchKeys = branchesParam.split(',').map(b => b.trim()).filter(Boolean);
    const pipelines: Record<string, any> = {};

    for (const branchKey of branchKeys) {
      // El formato es "grupo/proyecto/rama" - la rama es el último segmento
      const parts = branchKey.split('/');
      if (parts.length < 3) {
        pipelines[branchKey] = null;
        continue;
      }

      // Intentar encontrar la separación correcta entre projectPath y branchName
      // Probamos desde el penúltimo segmento hacia atrás
      let found = false;

      for (let splitAt = parts.length - 1; splitAt >= 2; splitAt--) {
        const candidatePath = parts.slice(0, splitAt).join('/');
        const candidateBranch = parts.slice(splitAt).join('/');

        const cacheKey = `pipeline:${candidatePath}:${candidateBranch}`;
        const cached = pipelinesCache.get(cacheKey);

        if (cached.data && !cached.isStale) {
          pipelines[branchKey] = cached.data;
          found = true;
          break;
        }

        // Buscar el proyecto
        const match = findServerForProject(candidatePath);
        if (!match) continue;

        try {
          const client = new GitLabClient(match.server.url, getServerToken(match.server.name));
          const pipeline = await client.getLatestPipeline(match.project.id, candidateBranch);

          const result = pipeline ? {
            id: pipeline.id,
            status: pipeline.status,
            ref: pipeline.ref,
            sha: pipeline.sha,
            web_url: pipeline.web_url,
            created_at: pipeline.created_at,
            updated_at: pipeline.updated_at,
            duration: pipeline.duration,
            started_at: pipeline.started_at,
            finished_at: pipeline.finished_at,
          } : null;

          pipelinesCache.set(cacheKey, result);
          pipelines[branchKey] = result;
          found = true;
          break;
        } catch (error) {
          console.error(`Error al obtener pipeline para ${branchKey}:`, (error as Error).message);
          continue;
        }
      }

      if (!found) {
        pipelines[branchKey] = null;
      }
    }

    return c.json({ pipelines });
  } catch (error) {
    console.error('Error en /api/status:', (error as Error).message);
    return c.json({ error: 'Error al obtener status', message: (error as Error).message }, 500);
  }
});

export default api;
