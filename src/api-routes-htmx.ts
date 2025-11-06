import express, { Request, Response } from 'express';
import { MultiLevelCacheManager } from './multi-level-cache';
import { GitLabClient } from './gitlab';
import { loadConfig } from './config';
import { renderTemplate, generateSafeId, formatStatus } from './template-renderer';
import { PipelineStatus } from './types';

const router = express.Router();
const config = loadConfig();
const cache = new MultiLevelCacheManager();

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

function logRequest(method: string, path: string, params?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📨 ${method} ${path}`, params ? JSON.stringify(params) : '');
}

function logCache(level: string, key: string, hit: boolean) {
  const emoji = hit ? '💾 HIT' : '❌ MISS';
  console.log(`${emoji} L${level} cache: ${key}`);
}

function logError(context: string, error: Error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ Error in ${context}:`, error.message);
}

/**
 * Check if project should be excluded based on config
 */
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

// ============================================================================
// LEVEL 3: Single Branch Pipeline Status (5sec TTL)
// ============================================================================

/**
 * GET /api/branches/:group/:project/:branch (and nested groups)
 * Returns: Single <tr> with branch pipeline status
 * Auto-refreshes every 5 seconds via htmx
 * Note: Uses custom middleware to handle nested paths
 */
router.get(/^\/branches\/(.+)$/, async (req: Request, res: Response) => {
  // Extract projectPath and branchName from regex capture
  // Format: /branches/{projectPath}/{branchName}
  const fullPath = req.params[0] || '';
  const pathParts = fullPath.split('/');
  const branchName = pathParts.pop() || '';
  const projectPath = pathParts.join('/');
  const includeJobs = req.query.includeJobs === 'true';
  
  logRequest('GET', `/api/branches/${projectPath}/${branchName}`, { includeJobs });

  try {
    // Check L3 cache (5sec TTL)
    let pipeline = cache.getPipeline(projectPath, branchName, includeJobs);
    
    if (pipeline === null) {
      logCache('3', `${projectPath}:${branchName}`, false);
      
      // Need to fetch from GitLab
      // First, find which server this project belongs to
      const server = config.servers.find(s => 
        s.projects?.some(p => p.path === projectPath) ||
        s.groups?.some(g => true) // TODO: better group matching
      );

      if (!server) {
        throw new Error(`Server not found for project: ${projectPath}`);
      }

      const client = new GitLabClient(server.url, server.token);
      
      // Extract project ID from path (assuming format: group/project or user/project)
      // This is a simplified approach; in production, we'd need project ID from L1/L2 cache
      const projectParts = projectPath.split('/');
      const projectName = projectParts[projectParts.length - 1];
      
      // Fetch pipeline from GitLab
      const projects = await client.getGroupProjects({ path: projectParts[0] });
      const project = projects.find(p => p.path_with_namespace === projectPath);
      
      if (!project) {
        throw new Error(`Project not found: ${projectPath}`);
      }

      pipeline = await client.getLatestPipeline(project.id, branchName);
      
      if (includeJobs && pipeline) {
        const jobs = await client.getPipelineJobs(project.id, pipeline.id);
        pipeline.jobs = jobs;
      }

      // Cache it
      cache.setPipeline(projectPath, branchName, pipeline, includeJobs);
    } else {
      logCache('3', `${projectPath}:${branchName}`, true);
    }

    // Render template
    const html = renderTemplate('branch-row', {
      projectPath,
      branchName,
      safeId: generateSafeId(`${projectPath}-${branchName}`),
      includeJobs,
      pipeline: pipeline ? {
        ...pipeline,
        statusText: formatStatus(pipeline.status),
      } : undefined,
      commitTitle: pipeline?.ref || '',
      commitShortId: pipeline?.sha?.substring(0, 8) || '',
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    logError(`/api/branches/${projectPath}/${branchName}`, error as Error);
    
    // Render error state
    const html = renderTemplate('branch-row', {
      projectPath,
      branchName,
      safeId: generateSafeId(`${projectPath}-${branchName}`),
      includeJobs,
      error: (error as Error).message,
    });
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(html);
  }
});

// ============================================================================
// LEVEL 2: Project Branches (5min TTL)
// ============================================================================

/**
 * GET /api/projects/:serverName/.../branches (regex route)
 * Returns: Single article element with project and all its branches
 * Auto-refreshes every 5 minutes via htmx
 * Note: projectPath extracted using regex after serverName
 */
router.get(/^\/projects\/([^/]+)\/(.+)\/branches$/, async (req: Request, res: Response) => {
  // Extract serverName and projectPath from regex captures
  const serverName = req.params[0] || '';
  const projectPath = req.params[1] || '';
  const includeJobs = req.query.includeJobs === 'true';
  
  logRequest('GET', `/api/projects/${serverName}/${projectPath}/branches`, { includeJobs });

  try {
    // Check L2 cache (5min TTL)
    let branches = cache.getBranches(projectPath);
    
    if (!branches) {
      logCache('2', projectPath, false);
      
      // Fetch from GitLab
      const server = config.servers.find(s => s.name === serverName);
      if (!server) {
        throw new Error(`Server not found: ${serverName}`);
      }

      const client = new GitLabClient(server.url, server.token);
      
      // Get project details from L1 cache or fetch
      const cachedProjects = cache.getGroupsProjects(serverName);
      const projectInfo = cachedProjects?.find(p => p.path === projectPath);
      
      if (!projectInfo) {
        throw new Error(`Project not found in cache: ${projectPath}`);
      }

      // Fetch branches from GitLab
      const gitlabBranches = await client.getBranches(projectInfo.id);
      
      branches = gitlabBranches.map(b => ({
        name: b.name,
        commitTitle: b.commit.title,
        commitShortId: b.commit.short_id,
      }));

      // Cache it
      cache.setBranches(projectPath, branches);
    } else {
      logCache('2', projectPath, true);
    }

    // Render each branch row (which will then auto-refresh independently)
    const branchRowsHtml = await Promise.all(
      branches.map(async (branch) => {
        // Each branch row will have its own htmx polling
        return renderTemplate('branch-row', {
          projectPath,
          branchName: branch.name,
          safeId: generateSafeId(`${projectPath}-${branch.name}`),
          includeJobs,
          commitTitle: branch.commitTitle,
          commitShortId: branch.commitShortId,
          // Pipeline will be fetched by the branch-row's own htmx request
        });
      })
    );

    // Render project section
    const projectInfo = cache.getGroupsProjects(serverName)?.find(p => p.path === projectPath);
    
    const html = renderTemplate('project-section', {
      serverName,
      projectPath,
      safeProjectId: generateSafeId(projectPath),
      name: projectInfo?.name || projectPath,
      url: projectInfo?.url || '',
      branches: branchRowsHtml,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    logError(`/api/projects/${serverName}/${projectPath}/branches`, error as Error);
    
    const html = renderTemplate('project-section', {
      serverName,
      projectPath,
      safeProjectId: generateSafeId(projectPath),
      error: (error as Error).message,
    });
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(html);
  }
});

// ============================================================================
// LEVEL 1: Server Projects (30min TTL)
// ============================================================================

/**
 * GET /api/servers/:serverName
 * Returns: Full <section> with server and all projects
 * Auto-refreshes every 30 minutes via htmx
 */
router.get('/servers/:serverName', async (req: Request, res: Response) => {
  const { serverName } = req.params;
  const includeJobs = req.query.includeJobs === 'true';
  
  logRequest('GET', `/api/servers/${serverName}`, { includeJobs });

  try {
    // Check L1 cache (30min TTL)
    let projects = cache.getGroupsProjects(serverName);
    
    if (!projects) {
      logCache('1', serverName, false);
      
      // Fetch from GitLab
      const server = config.servers.find(s => s.name === serverName);
      if (!server) {
        throw new Error(`Server not found: ${serverName}`);
      }

      const client = new GitLabClient(server.url, server.token);
      const allProjectConfigs: any[] = [];

      // Fetch configured projects
      if (server.projects && server.projects.length > 0) {
        allProjectConfigs.push(...server.projects);
      }

      // Fetch groups
      if (server.groups && server.groups.length > 0) {
        for (const groupConfig of server.groups) {
          try {
            const groupProjects = await client.getGroupProjects(groupConfig);
            allProjectConfigs.push(...groupProjects.map(p => ({
              id: p.id,
              name: p.name,
              path: p.path_with_namespace,
            })));
          } catch (error) {
            logError(`Fetch group ${groupConfig.path || groupConfig.id}`, error as Error);
          }
        }
      }

      // Fetch project details and filter exclusions
      projects = [];
      for (const projectConfig of allProjectConfigs) {
        try {
          const project = await client.getProject(projectConfig);
          
          if (!isProjectExcluded(project.name, project.path_with_namespace)) {
            projects.push({
              id: project.id,
              name: project.name,
              path: project.path_with_namespace,
              url: project.web_url,
            });
          }
        } catch (error) {
          logError(`Fetch project ${projectConfig.path || projectConfig.id}`, error as Error);
        }
      }

      // Cache it
      cache.setGroupsProjects(serverName, projects);
    } else {
      logCache('1', serverName, true);
    }

    // Render each project section (which will then auto-refresh independently)
    const projectSectionsHtml = await Promise.all(
      projects.map(async (project) => {
        // Each project section will have its own htmx polling
        return renderTemplate('project-section', {
          serverName,
          projectPath: project.path,
          safeProjectId: generateSafeId(project.path),
          name: project.name,
          url: project.url,
          branches: [], // Will be loaded by project-section's own htmx request
        });
      })
    );

    // Render server section
    const html = renderTemplate('server-section', {
      serverName,
      safeServerId: generateSafeId(serverName),
      projects: projectSectionsHtml,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    logError(`/api/servers/${serverName}`, error as Error);
    
    const html = `<section><h2>${serverName}</h2><p><em>Error: ${(error as Error).message}</em></p></section>`;
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(html);
  }
});

export default router;
