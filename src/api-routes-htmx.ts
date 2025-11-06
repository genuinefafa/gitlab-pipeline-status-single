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
// UTILITY FUNCTIONS
// ============================================================================

function logRequest(method: string, path: string, params?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📨 ${method} ${path}`, params ? JSON.stringify(params) : '');
}

/**
 * Group jobs by stage, preserving the order in which stages first appear
 * NOTE: GitLab returns jobs in reverse stage order, so we reverse the final array
 */
function groupJobsByStage(jobs: any[]): { stages: any[]; hasStages: boolean } {
  if (!jobs || jobs.length === 0) {
    return { stages: [], hasStages: false };
  }
  
  // Group by stage preserving first occurrence order
  const stageOrder: string[] = [];
  const stageMap = new Map<string, any[]>();
  
  jobs.forEach((job: any) => {
    const stageName = job.stage || 'default';
    if (!stageMap.has(stageName)) {
      stageMap.set(stageName, []);
      stageOrder.push(stageName); // Track order of first occurrence
    }
    stageMap.get(stageName)!.push(job);
  });
  
  // Create stages array in the order they first appeared, then reverse
  // because GitLab API returns jobs in reverse chronological order
  const stages = stageOrder.map(stageName => ({
    name: stageName,
    jobs: stageMap.get(stageName)!
  })).reverse();
  
  return { stages, hasStages: stages.length > 0 };
}

function logCache(level: string, key: string, hit: boolean, isStale: boolean = false) {
  const emoji = hit ? (isStale ? '🔄 STALE' : '💾 HIT') : '❌ MISS';
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
  const viewMode = req.query.view === 'chart' ? 'chart' : 'list';
  const contentOnly = req.query.contentOnly === 'true';
  const summaryOnly = req.query.summaryOnly === 'true';
  
  logRequest('GET', `/api/branches/${projectPath}/${branchName}`, { includeJobs, viewMode, contentOnly });

  try {
    // Check L3 cache (5sec TTL)
    const cacheResult = cache.getPipeline(projectPath, branchName, includeJobs);
    let pipeline = cacheResult.data;
    let isRefreshing = false;
    
    if (cacheResult.data === null || cacheResult.isStale) {
      logCache('3', `${projectPath}:${branchName}`, cacheResult.data !== null, cacheResult.isStale);
      
      // Mark as refreshing if we have stale data
      isRefreshing = cacheResult.isStale && cacheResult.data !== null;
      
      // Need to fetch from GitLab (either no data or stale data)
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

      const freshPipeline = await client.getLatestPipeline(project.id, branchName);
      
      if (includeJobs && freshPipeline) {
        const jobs = await client.getPipelineJobs(project.id, freshPipeline.id);
        freshPipeline.jobs = jobs;
      }

      // Cache the fresh data
      cache.setPipeline(projectPath, branchName, freshPipeline, includeJobs);
      
      // Use fresh data if we didn't have stale data to show
      if (!isRefreshing) {
        pipeline = freshPipeline;
      }
    } else {
      logCache('3', `${projectPath}:${branchName}`, true, false);
    }

    // Group jobs by stage if available
    const { stages, hasStages } = groupJobsByStage(pipeline?.jobs || []);
    
    // Choose template based on view mode and contentOnly flag
    let templateName = 'branch-row';
    if (viewMode === 'chart') {
      if (contentOnly) {
        templateName = 'branch-chart-content';
      } else if (summaryOnly) {
        templateName = 'branch-chart-summary';
      } else {
        templateName = 'branch-chart';
      }
    } else if (viewMode === 'list') {
      templateName = contentOnly ? 'branch-row-content' : 'branch-row';
    }
    
    // Render template
    const html = renderTemplate(templateName, {
      projectPath,
      branchName,
      safeId: generateSafeId(`${projectPath}-${branchName}`),
      includeJobs,
      lastRefresh: Date.now(),
      pipeline: pipeline ? {
        ...pipeline,
        statusText: formatStatus(pipeline.status),
      } : undefined,
      hasJobs: pipeline?.jobs && pipeline.jobs.length > 0,
      stages,
      hasStages,
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
      lastRefresh: Date.now(),
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
  const rowsOnly = req.query.rowsOnly === 'true';
  const viewMode = req.query.view === 'chart' ? 'chart' : 'list';
  
  logRequest('GET', `/api/projects/${serverName}/${projectPath}/branches`, { includeJobs, rowsOnly, viewMode });

  try {
    // Check L2 cache (5min TTL)
    const branchesResult = cache.getBranches(projectPath);
    let branches = branchesResult.data;
    
    if (!branches || branchesResult.isStale) {
      logCache('2', projectPath, branches !== null, branchesResult.isStale);
      
      // Fetch from GitLab
      const server = config.servers.find(s => s.name === serverName);
      if (!server) {
        throw new Error(`Server not found: ${serverName}`);
      }

      const client = new GitLabClient(server.url, server.token);
      
      // Get project details from L1 cache or fetch
      const projectsResult = cache.getGroupsProjects(serverName);
      const projectInfo = projectsResult.data?.find(p => p.path === projectPath);
      
      if (!projectInfo) {
        throw new Error(`Project not found in cache: ${projectPath}`);
      }

      // Fetch branches from GitLab
      const gitlabBranches = await client.getBranches(projectInfo.id);
      
      const freshBranches = gitlabBranches.map(b => ({
        name: b.name,
        commitTitle: b.commit.title,
        commitShortId: b.commit.short_id,
      }));

      // Cache it
      cache.setBranches(projectPath, freshBranches);
      
      // Use fresh data if we don't have stale to show
      if (!branchesResult.isStale || !branches) {
        branches = freshBranches;
      }
    } else {
      logCache('2', projectPath, true, false);
    }

    // Choose template based on view mode
    const branchTemplateName = viewMode === 'chart' ? 'branch-chart' : 'branch-row';
    
    // Render each branch row/item (which will then auto-refresh independently)
    const branchRowsHtml = await Promise.all(
      branches.map(async (branch) => {
        // Try to get pipeline from cache
        const pipelineResult = cache.getPipeline(projectPath, branch.name, includeJobs);
        const cachedPipeline = pipelineResult.data;
        
        // Group jobs by stage if available
        const { stages, hasStages } = groupJobsByStage(cachedPipeline?.jobs || []);
        
        // Each branch row will have its own htmx polling
        return renderTemplate(branchTemplateName, {
          projectPath,
          branchName: branch.name,
          safeId: generateSafeId(`${projectPath}-${branch.name}`),
          includeJobs,
          lastRefresh: Date.now(),
          isRefreshing: pipelineResult.isStale,
          pipeline: cachedPipeline ? {
            ...cachedPipeline,
            statusText: formatStatus(cachedPipeline.status),
          } : undefined,
          hasJobs: cachedPipeline?.jobs && cachedPipeline.jobs.length > 0,
          stages,
          hasStages,
          commitTitle: branch.commitTitle,
          commitShortId: branch.commitShortId,
        });
      })
    );

    // If rowsOnly, just return the branch rows HTML
    if (rowsOnly) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(branchRowsHtml.join(''));
    }
    
    // Otherwise, render full project section
    const projectsResult = cache.getGroupsProjects(serverName);
    const projectInfo = projectsResult.data?.find(p => p.path === projectPath);
    const projectTemplateName = viewMode === 'chart' ? 'project-chart' : 'project-section';
    
    const html = renderTemplate(projectTemplateName, {
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
 * Strategy: Always return cached data first, then trigger background refresh if needed
 */
router.get('/servers/:serverName', async (req: Request, res: Response) => {
  const { serverName } = req.params;
  const includeJobs = req.query.includeJobs === 'true';
  const forceRefresh = req.query.force === 'true';
  const viewMode = req.query.view === 'chart' ? 'chart' : 'list';
  
  logRequest('GET', `/api/servers/${serverName}`, { includeJobs, forceRefresh, viewMode });

  try {
    // Check L1 cache (30min TTL)
    const projectsResult = cache.getGroupsProjects(serverName);
    let projects = projectsResult.data;
    const hasCache = projects !== null;
    
    // If we have cache and not forcing refresh, return immediately with stale data if needed
    if (hasCache && !forceRefresh) {
      logCache('1', serverName, true, projectsResult.isStale);
      
      // Choose templates based on view mode
      const projectTemplateName = viewMode === 'chart' ? 'project-chart' : 'project-section';
      const serverTemplateName = viewMode === 'chart' ? 'server-chart' : 'server-section';
      
      // Render server section with cached data
      const projectSectionsHtml = await Promise.all(
        projects!.map(async (project) => {
          return renderTemplate(projectTemplateName, {
            serverName,
            projectPath: project.path,
            safeProjectId: generateSafeId(project.path),
            name: project.name,
            url: project.url,
            branches: [],
            isRefreshing: projectsResult.isStale,
          });
        })
      );

      const html = renderTemplate(serverTemplateName, {
        serverName,
        safeServerId: generateSafeId(serverName),
        projects: projectSectionsHtml,
        isRefreshing: projectsResult.isStale,
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    
    // No cache or forced refresh - fetch from GitLab
    logCache('1', serverName, false, false);
    
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

    // Choose templates based on view mode
    const branchTemplateName = viewMode === 'chart' ? 'branch-chart' : 'branch-row';
    const projectTemplateName = viewMode === 'chart' ? 'project-chart' : 'project-section';
    const serverTemplateName = viewMode === 'chart' ? 'server-chart' : 'server-section';
    
    // Render each project section with initial branch rows
    const projectSectionsHtml = await Promise.all(
      projects.map(async (project) => {
        // Get branches from L2 cache
        const branchesResult = cache.getBranches(project.path);
        const branches = branchesResult.data;
        let branchRowsHtml: string[] = [];
        
        if (branches && branches.length > 0) {
          // Render branch rows with cached pipelines if available
          branchRowsHtml = await Promise.all(
            branches.map(async (branch) => {
              // Try to get pipeline from cache
              const pipelineResult = cache.getPipeline(project.path, branch.name, true);
              const cachedPipeline = pipelineResult.data;
              
              // Group jobs by stage if available
              const { stages, hasStages } = groupJobsByStage(cachedPipeline?.jobs || []);
              
              return renderTemplate(branchTemplateName, {
                projectPath: project.path,
                branchName: branch.name,
                safeId: generateSafeId(`${project.path}-${branch.name}`),
                includeJobs: true,
                lastRefresh: Date.now(),
                isRefreshing: pipelineResult.isStale,
                pipeline: cachedPipeline ? {
                  ...cachedPipeline,
                  statusText: formatStatus(cachedPipeline.status),
                } : undefined,
                hasJobs: cachedPipeline?.jobs && cachedPipeline.jobs.length > 0,
                stages,
                hasStages,
                commitTitle: branch.commitTitle,
                commitShortId: branch.commitShortId,
              });
            })
          );
        }
        
        return renderTemplate(projectTemplateName, {
          serverName,
          projectPath: project.path,
          safeProjectId: generateSafeId(project.path),
          name: project.name,
          url: project.url,
          branches: branchRowsHtml,
        });
      })
    );

    // Render server section
    const html = renderTemplate(serverTemplateName, {
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
