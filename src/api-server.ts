import express, { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CacheManager } from './cache';
import { GitLabClient } from './gitlab';
import { TreeData, ProjectTreeNode, ProjectConfig } from './types';
import { loadConfig } from './config';

const app = express();
const PORT = 3001;
const config = loadConfig();
const cache = new CacheManager();

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

function logRequest(method: string, path: string, params?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📨 ${method} ${path}`, params ? JSON.stringify(params) : '');
}

function logGitLab(action: string, details: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🦊 GitLab: ${action} - ${details}`);
}

function logError(context: string, error: Error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ Error in ${context}:`, error.message);
  if (error.stack) {
    console.error(error.stack);
  }
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

/**
 * Fetch all pipeline data
 */
async function fetchPipelineData(includeJobs: boolean = false): Promise<TreeData[]> {
  const allData: TreeData[] = [];

  for (const server of config.servers) {
    logGitLab('Connecting', `${server.name} (${server.url})`);
    const client = new GitLabClient(server.url, server.token);
    const projects: ProjectTreeNode[] = [];
    const allProjectConfigs: ProjectConfig[] = [];

    if (server.projects && server.projects.length > 0) {
      logGitLab('Projects', `Loading ${server.projects.length} configured projects from ${server.name}`);
      allProjectConfigs.push(...server.projects);
    }

    if (server.groups && server.groups.length > 0) {
      logGitLab('Groups', `Fetching ${server.groups.length} groups from ${server.name}`);
      for (const groupConfig of server.groups) {
        try {
          const groupProjects = await client.getGroupProjects(groupConfig);
          logGitLab('Group fetched', `${groupProjects.length} projects in group ${groupConfig.path || groupConfig.id}`);
          const projectConfigs = groupProjects.map((project) => ({
            id: project.id,
            name: project.name,
            path: project.path_with_namespace,
          }));
          allProjectConfigs.push(...projectConfigs);
        } catch (error) {
          logError(`Fetch group ${groupConfig.path || groupConfig.id}`, error as Error);
          projects.push({
            name: groupConfig.name || groupConfig.path || `Group ${groupConfig.id}`,
            path: groupConfig.path || `Group ID: ${groupConfig.id}`,
            url: '',
            branches: [],
            error: `Failed to fetch group: ${(error as Error).message}`,
          });
        }
      }
    }

    for (const projectConfig of allProjectConfigs) {
      try {
        const project = await client.getProject(projectConfig);
        logGitLab('Project', `Fetched ${project.path_with_namespace}`);

        if (isProjectExcluded(project.name, project.path_with_namespace)) {
          logGitLab('Project excluded', project.path_with_namespace);
          continue;
        }

        const branches = await client.getBranches(project.id);
        logGitLab('Branches', `${branches.length} branches in ${project.path_with_namespace}`);
        
        const branchData = await Promise.all(
          branches.map(async (branch) => {
            try {
              const pipeline = await client.getLatestPipeline(project.id, branch.name);

              if (includeJobs && pipeline) {
                const jobs = await client.getPipelineJobs(project.id, pipeline.id);
                logGitLab('Jobs', `${jobs.length} jobs in pipeline ${pipeline.id} for ${project.path_with_namespace}/${branch.name}`);
                pipeline.jobs = jobs;
              }

              return {
                name: branch.name,
                commitTitle: branch.commit.title,
                commitShortId: branch.commit.short_id,
                pipeline: pipeline || undefined,
              };
            } catch (error) {
              logError(`Fetch pipeline for ${project.path_with_namespace}/${branch.name}`, error as Error);
              return {
                name: branch.name,
                error: (error as Error).message,
              };
            }
          })
        );

        projects.push({
          name: project.name,
          path: project.path_with_namespace,
          url: project.web_url,
          branches: branchData,
        });
      } catch (error) {
        logError(`Fetch project ${projectConfig.path || projectConfig.id}`, error as Error);
        projects.push({
          name: projectConfig.name || projectConfig.path || `Project ${projectConfig.id}`,
          path: projectConfig.path || `Project ID: ${projectConfig.id}`,
          url: '',
          branches: [],
          error: (error as Error).message,
        });
      }
    }

    allData.push({
      serverName: server.name,
      projects,
    });
  }

  return allData;
}

/**
 * Standard API endpoint
 */
app.get('/api/pipelines', async (req: Request, res: Response) => {
  const force = req.query.force === 'true';
  const includeJobs = req.query.includeJobs === 'true';
  
  logRequest('GET', '/api/pipelines', { force, includeJobs });

  try {
    let data: TreeData[] | null = null;
    let duration: number | undefined;

    data = cache.get(force, includeJobs);

    if (!data) {
      console.log(`💾 Cache miss - fetching fresh data (includeJobs=${includeJobs})`);
      const startTime = Date.now();
      data = await fetchPipelineData(includeJobs);
      duration = Date.now() - startTime;
      cache.set(data, includeJobs, duration);
      console.log(`✅ Fetch completed in ${(duration / 1000).toFixed(2)}s`);
    } else {
      const cacheAge = cache.getAge(includeJobs);
      console.log(`💾 Cache hit - serving cached data (age: ${cacheAge}s)`);
    }

    const cacheAge = cache.getAge(includeJobs);
    const cacheDuration = cache.getDuration(includeJobs);

    res.json({
      data,
      cached: !force && cacheAge !== null,
      cacheAge,
      cacheDuration,
      includeJobs,
      timestamp: Date.now(),
    });
  } catch (error) {
    logError('/api/pipelines', error as Error);
    res.status(500).json({
      error: 'Failed to fetch pipeline data',
      message: (error as Error).message,
    });
  }
});

/**
 * SSE streaming endpoint
 */
app.get('/api/pipelines/stream', async (req: Request, res: Response) => {
  const force = req.query.force === 'true';
  const includeJobs = req.query.includeJobs === 'true';
  
  logRequest('GET', '/api/pipelines/stream', { force, includeJobs });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let data = cache.get(force, includeJobs);

    if (data) {
      console.log(`💾 SSE: Cache hit - streaming cached data`);
      send('complete', {
        data,
        cached: true,
        cacheAge: cache.getAge(includeJobs),
        cacheDuration: cache.getDuration(includeJobs),
      });
      res.end();
      return;
    }
    
    console.log(`💾 SSE: Cache miss - streaming fresh data`);

    const startTime = Date.now();
    const allData: TreeData[] = [];
    let totalProjects = 0;
    let processedProjects = 0;

    for (const server of config.servers) {
      send('progress', { message: `Connecting to ${server.name}...`, stage: 'init' });

      const client = new GitLabClient(server.url, server.token);
      const projects: ProjectTreeNode[] = [];
      const allProjectConfigs: ProjectConfig[] = [];

      if (server.projects && server.projects.length > 0) {
        allProjectConfigs.push(...server.projects);
      }

      if (server.groups && server.groups.length > 0) {
        send('progress', { message: `Fetching groups from ${server.name}...`, stage: 'groups' });
        for (const groupConfig of server.groups) {
          try {
            const groupProjects = await client.getGroupProjects(groupConfig);
            const projectConfigs = groupProjects.map((project) => ({
              id: project.id,
              name: project.name,
              path: project.path_with_namespace,
            }));
            allProjectConfigs.push(...projectConfigs);
          } catch (error) {
            projects.push({
              name: groupConfig.name || groupConfig.path || `Group ${groupConfig.id}`,
              path: groupConfig.path || `Group ID: ${groupConfig.id}`,
              url: '',
              branches: [],
              error: `Failed to fetch group: ${(error as Error).message}`,
            });
          }
        }
      }

      totalProjects += allProjectConfigs.length;
      send('progress', {
        message: `Found ${allProjectConfigs.length} projects in ${server.name}`,
        stage: 'projects',
        total: totalProjects,
      });

      for (const projectConfig of allProjectConfigs) {
        try {
          const project = await client.getProject(projectConfig);

          if (isProjectExcluded(project.name, project.path_with_namespace)) {
            totalProjects--;
            continue;
          }

          processedProjects++;
          send('progress', {
            message: `Processing ${project.name} (${processedProjects}/${totalProjects})`,
            stage: 'fetching',
            current: processedProjects,
            total: totalProjects,
          });

          const branches = await client.getBranches(project.id);
          const branchData = await Promise.all(
            branches.map(async (branch) => {
              try {
                const pipeline = await client.getLatestPipeline(project.id, branch.name);

                if (includeJobs && pipeline) {
                  const jobs = await client.getPipelineJobs(project.id, pipeline.id);
                  pipeline.jobs = jobs;
                }

                return {
                  name: branch.name,
                  commitTitle: branch.commit.title,
                  commitShortId: branch.commit.short_id,
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

          projects.push({
            name: project.name,
            path: project.path_with_namespace,
            url: project.web_url,
            branches: branchData,
          });
        } catch (error) {
          processedProjects++;
          projects.push({
            name: projectConfig.name || projectConfig.path || `Project ${projectConfig.id}`,
            path: projectConfig.path || `Project ID: ${projectConfig.id}`,
            url: '',
            branches: [],
            error: (error as Error).message,
          });
        }
      }

      allData.push({
        serverName: server.name,
        projects,
      });
    }

    const duration = Date.now() - startTime;
    cache.set(allData, includeJobs, duration);
    console.log(`✅ SSE: Fetch completed in ${(duration / 1000).toFixed(2)}s`);

    send('complete', { data: allData, cached: false, cacheDuration: duration / 1000 });
    res.end();
  } catch (error) {
    logError('/api/pipelines/stream', error as Error);
    send('error', { message: (error as Error).message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 API Server running on http://localhost:${PORT}`);
  console.log(`📡 Monitoring ${config.servers.length} GitLab server(s)\n`);
});
