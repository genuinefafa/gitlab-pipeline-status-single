import express, { Request, Response } from 'express';
import { loadConfig } from './config';
import { GitLabClient } from './gitlab';
import { CacheManager } from './cache';
import { TreeData, ProjectTreeNode, ProjectConfig } from './types';

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new CacheManager();

let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (error) {
  console.error('Failed to load configuration:');
  console.error((error as Error).message);
  process.exit(1);
}

/**
 * Check if a project should be excluded
 */
function isProjectExcluded(projectName: string, projectPath: string): boolean {
  if (!config.excludeProjects || config.excludeProjects.length === 0) {
    return false;
  }

  const lowerName = projectName.toLowerCase();
  const lowerPath = projectPath.toLowerCase();

  return config.excludeProjects.some((excluded) => {
    const lowerExcluded = excluded.toLowerCase();
    return lowerName.includes(lowerExcluded) || lowerPath.includes(lowerExcluded);
  });
}

/**
 * Fetch fresh pipeline data from GitLab
 */
async function fetchPipelineData(includeJobs: boolean = false): Promise<TreeData[]> {
  const allData: TreeData[] = [];

  for (const server of config.servers) {
    const resolvedToken = server.token ?? (server.tokens && server.tokens.length > 0 ? server.tokens[0].value : undefined);
    if (!resolvedToken) {
      throw new Error(`No token configured for server ${server.name}`);
    }
    const client = new GitLabClient(server.url, resolvedToken);
    const projects: ProjectTreeNode[] = [];

    const allProjectConfigs = [];

    // Add individual projects
    if (server.projects && server.projects.length > 0) {
      allProjectConfigs.push(...server.projects);
    }

    // Fetch projects from groups
    if (server.groups && server.groups.length > 0) {
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

    // Fetch all projects in parallel
    const projectPromises = allProjectConfigs.map(async (projectConfig) => {
      try {
        const project = await client.getProject(projectConfig);
        
        // Skip excluded projects
        if (isProjectExcluded(project.name, project.path_with_namespace)) {
          return null;
        }
        
    const branches = await client.getBranches(project.id);

        const branchPromises = branches.map(async (branch) => {
          try {
            const pipeline = await client.getLatestPipeline(project.id, branch.name);
            
            // If requested and pipeline exists, fetch its jobs
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
        });

        const branchData = await Promise.all(branchPromises);

        return {
          name: project.name,
          path: project.path_with_namespace,
          url: project.web_url,
          branches: branchData,
        };
      } catch (error) {
        return {
          name: projectConfig.name || projectConfig.path || `Project ${projectConfig.id}`,
          path: projectConfig.path || `Project ID: ${projectConfig.id}`,
          url: '',
          branches: [],
          error: (error as Error).message,
        };
      }
    });

    const fetchedProjects = await Promise.all(projectPromises);
    
    // Filter out null values (excluded projects)
    projects.push(...fetchedProjects.filter(p => p !== null));

    allData.push({
      serverName: server.name,
      projects,
    });
  }

  return allData;
}

/**
 * API endpoint to get pipeline data
 */
app.get('/api/pipelines', async (req: Request, res: Response) => {
  const force = req.query.force === 'true';
  const includeJobs = req.query.includeJobs === 'true';

  try {
    let data: TreeData[] | null = null;
    let duration: number | undefined;

    // Try to get from cache first
    data = cache.get(force, includeJobs);

    if (!data) {
      // Fetch fresh data
      const startTime = Date.now();
      data = await fetchPipelineData(includeJobs);
      duration = Date.now() - startTime;
      cache.set(data, includeJobs, duration);
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
    console.error('Error fetching pipeline data:', error);
    res.status(500).json({
      error: 'Failed to fetch pipeline data',
      message: (error as Error).message,
    });
  }
});

/**
 * Server-sent events endpoint for streaming progress
 */
app.get('/api/pipelines/stream', async (req: Request, res: Response) => {
  const force = req.query.force === 'true';
  const includeJobs = req.query.includeJobs === 'true';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Check cache first
    let data = cache.get(force, includeJobs);

    if (data) {
      send('complete', { data, cached: true, cacheAge: cache.getAge(includeJobs), cacheDuration: cache.getDuration(includeJobs) });
      res.end();
      return;
    }

    // Fetch fresh data with progress
    const startTime = Date.now();
    const allData: TreeData[] = [];
    let totalProjects = 0;
    let processedProjects = 0;

    for (const server of config.servers) {
      send('progress', { message: `Connecting to ${server.name}...`, stage: 'init' });
      const resolvedToken = server.token ?? (server.tokens && server.tokens.length > 0 ? server.tokens[0].value : undefined);
      if (!resolvedToken) {
        throw new Error(`No token configured for server ${server.name}`);
      }
      const client = new GitLabClient(server.url, resolvedToken);
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
        total: totalProjects 
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

    // Save to cache
    const duration = Date.now() - startTime;
    cache.set(allData, includeJobs, duration);

    send('complete', { data: allData, cached: false, cacheDuration: duration / 1000 });
    res.end();
  } catch (error) {
    send('error', { message: (error as Error).message });
    res.end();
  }
});

/**
 * Serve the main HTML page
 */
app.get('/', (req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitLab Pipeline Monitor</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/modern-normalize@2.0.0/modern-normalize.min.css">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.5;
      padding: 1rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    button {
      padding: 0.5rem 1rem;
      cursor: pointer;
      font-size: 0.9rem;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    button.active {
      font-weight: bold;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #ddd;
    }
    
    .controls {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    
    .loading {
       text-align: center;
       padding: 3rem;
       font-size: 1.1rem;
     }
   
     .spinner {
       display: inline-block;
       width: 40px;
       height: 40px;
       border: 4px solid #ddd;
       border-top-color: #2563eb;
       border-radius: 50%;
       animation: spin 1s linear infinite;
       margin-bottom: 1rem;
     }
   
     @keyframes spin {
       to { transform: rotate(360deg); }
    }
    
    .server-section {
      margin-bottom: 2rem;
      border: 1px solid #ddd;
      padding: 1rem;
    }
    
    .server-section h2 {
      margin-top: 0;
      margin-bottom: 1rem;
      border-bottom: 1px solid #ddd;
      padding-bottom: 0.5rem;
    }
    
    .project-card {
      margin-bottom: 1.5rem;
      border-left: 3px solid #ccc;
      padding-left: 1rem;
    }
    
    .project-card.has-error {
      border-left-color: #dc2626;
    }
    
    .project-name {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    
    .project-path {
      color: #666;
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
    }
    
    .branches {
      margin-top: 0.5rem;
    }
    
    .branch {
      display: grid;
      grid-template-columns: 150px 1fr auto;
      gap: 1rem;
      align-items: center;
      padding: 0.5rem;
      border-bottom: 1px solid #eee;
    }
    
    .branch-name {
      font-weight: 500;
      font-family: monospace;
    }
    
    .commit-info {
      font-size: 0.9rem;
      color: #666;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .pipeline-status {
       padding: 0.25rem 0.5rem;
       font-size: 0.75rem;
       font-weight: 600;
       text-transform: uppercase;
       white-space: nowrap;
       text-decoration: none;
       display: inline-flex;
       align-items: center;
       gap: 0.25rem;
     }
   
     .status-success { background: #16a34a; color: #fff; }
     .status-success::before { content: '🟢'; }
   
     .status-failed { background: #dc2626; color: #fff; }
     .status-failed::before { content: '🔴'; }
   
     .status-running { background: #2563eb; color: #fff; }
     .status-running::before { content: '🔵'; }
   
  .status-pending { background: #facc15; color: #111827; }
     .status-pending::before { content: '🟡'; }
   
     .status-canceled { background: #6b7280; color: #fff; }
     .status-canceled::before { content: '⚫'; }
   
     .status-skipped { background: #6b7280; color: #fff; }
     .status-skipped::before { content: '⚪'; }
   
     .status-manual { background: #9333ea; color: #fff; }
     .status-manual::before { content: '🟣'; }
   
     .status-created { background: #6b7280; color: #fff; }
     .status-created::before { content: '⚫'; }
   
     .status-waiting_for_resource { background: #ea580c; color: #fff; }
     .status-waiting_for_resource::before { content: '🟠'; }
   
     .status-preparing { background: #ea580c; color: #fff; }
     .status-preparing::before { content: '🟠'; }
   
     .status-none { background: #6b7280; color: #fff; }
     .status-none::before { content: '⚪'; }
    
    .error-message {
      color: #dc2626;
      padding: 0.5rem;
      background: #fee;
      border-left: 3px solid #dc2626;
    }
    
    .cache-info {
      font-size: 0.85rem;
      color: #666;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    
    .stat-card {
      padding: 1rem;
      border: 1px solid #ddd;
      text-align: center;
    }
    
    .stat-value {
      font-size: 1.5rem;
      font-weight: bold;
    }
    
    .stat-label {
      font-size: 0.8rem;
      color: #666;
      text-transform: uppercase;
    }

    .view-toggle {
      margin-bottom: 1rem;
      display: flex;
      gap: 0.5rem;
    }

    .graph-view {
      display: none;
    }

    .graph-view.active {
      display: block;
    }

    .list-view {
      display: none;
    }

    .list-view.active {
      display: block;
    }

    .project-graph {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .graph-node {
      padding: 1rem;
      border: 1px solid #ddd;
      width: 100%;
    }

    .graph-node.status-success {
      border-left: 4px solid #16a34a;
    }

    .graph-node.status-failed {
      border-left: 4px solid #dc2626;
    }

    .graph-node.status-running {
      border-left: 4px solid #2563eb;
    }

    .graph-node-title {
      font-weight: 600;
      margin-bottom: 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #ddd;
    }

    .graph-node-branches {
      font-size: 0.85rem;
    }

    .graph-branch {
      padding: 0.5rem 0;
      border-bottom: 1px solid #eee;
    }

    .graph-branch:last-child {
      border-bottom: none;
    }

    .graph-branch-name {
      font-weight: 500;
      font-family: monospace;
      margin-bottom: 0.25rem;
    }

    .pipeline-jobs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-top: 0.25rem;
    }

    .job-badge {
      font-size: 0.7rem;
      padding: 0.2rem 0.4rem;
      background: #eee;
      border-radius: 2px;
    }

    .job-badge.success { background: #dcfce7; color: #166534; }
    .job-badge.failed { background: #fee2e2; color: #991b1b; }
    .job-badge.running { background: #dbeafe; color: #1e40af; }
    .job-badge.pending { background: #fef3c7; color: #92400e; }
    .job-badge.canceled { background: #e5e7eb; color: #374151; }
    .job-badge.skipped { background: #e5e7eb; color: #6b7280; }

    /* Stage timeline */
    .stage-timeline {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
    }
    .stage-segment {
      height: 8px;
      border-radius: 4px;
      flex: 1 1 0;
      background: #eee;
      position: relative;
    }
    .stage-segment.status-success { background: #16a34a; }
    .stage-segment.status-failed { background: #dc2626; }
    .stage-segment.status-running { background: #2563eb; }
    .stage-segment.status-pending { background: #facc15; }
    .stage-segment.status-canceled { background: #6b7280; }
    .stage-segment.status-skipped { background: #9ca3af; }
    .stage-segment.status-manual { background: #9333ea; }
    .stage-segment.status-created { background: #6b7280; }
    .stage-segment.status-waiting_for_resource { background: #ea580c; }
    .stage-segment.status-preparing { background: #ea580c; }
    .stage-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 10px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>GitLab Pipeline Monitor</h1>
    <div class="controls">
      <span id="cache-info" class="cache-info"></span>
      <button id="refresh-btn" onclick="loadData(true)">Force Refresh</button>
      <button onclick="loadData(false)">Refresh</button>
    </div>
  </div>
  
  <div class="view-toggle">
    <button class="active" onclick="switchView('list')">List View</button>
    <button onclick="switchView('graph')">Graph View</button>
  </div>

  <div id="stats" class="stats"></div>
  <div id="list-view" class="list-view active">
    <div class="loading">
      <div class="spinner"></div>
      <div>Loading pipeline data...</div>
    </div>
  </div>
  <div id="graph-view" class="graph-view"></div>

  <script>
    let autoRefreshInterval = null;
    let currentView = 'list';
    let cachedData = null;

    // Initialize view from URL hash
    function initializeView() {
      const hash = window.location.hash.substring(1); // Remove #
      if (hash === 'graph' || hash === 'list') {
        currentView = hash;
        document.querySelectorAll('.view-toggle button').forEach(btn => {
          btn.classList.remove('active');
        });
        document.querySelector('[onclick*="' + hash + '"]').classList.add('active');
        
        if (hash === 'list') {
          document.getElementById('list-view').classList.add('active');
          document.getElementById('graph-view').classList.remove('active');
        } else {
          document.getElementById('list-view').classList.remove('active');
          document.getElementById('graph-view').classList.add('active');
        }
      }
    }

    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
      initializeView();
      if (cachedData) {
        renderData(cachedData);
      }
    });

    // Standard GitLab stage order
    const STAGE_ORDER = [
      '.pre',
      'build',
      'test',
      'deploy',
      'staging',
      'production',
      'cleanup',
      '.post'
    ];

    function sortJobs(jobs) {
      if (!jobs || jobs.length === 0) return [];
      
      return jobs.slice().sort((a, b) => {
        const aIndex = STAGE_ORDER.indexOf(a.stage.toLowerCase());
        const bIndex = STAGE_ORDER.indexOf(b.stage.toLowerCase());
        
        // If both stages are in the order list, sort by that
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        
        // If only one is in the list, prioritize it
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        
        // Otherwise, sort alphabetically by stage, then by job name
        const stageCmp = a.stage.localeCompare(b.stage);
        return stageCmp !== 0 ? stageCmp : a.name.localeCompare(b.name);
      });
    }

    function renderPipelineSVG(pipeline) {
      if (!pipeline || !pipeline.jobs || pipeline.jobs.length === 0) {
        return '<span class="pipeline-status status-none" title="No pipeline">No pipeline</span>';
      }

      const sorted = sortJobs(pipeline.jobs);
      
      // Group by stage
      const stages = {};
      sorted.forEach(job => {
        if (!stages[job.stage]) {
          stages[job.stage] = [];
        }
        stages[job.stage].push(job);
      });

      const stageNames = Object.keys(stages);
      const stageWidth = 120;
      const stageHeight = 60;
      const jobHeight = 35;
      const padding = 20;
      
      let maxJobsInStage = 0;
      stageNames.forEach(stage => {
        if (stages[stage].length > maxJobsInStage) {
          maxJobsInStage = stages[stage].length;
        }
      });
      
      const width = (stageNames.length * stageWidth) + (padding * 2);
      const height = (maxJobsInStage * jobHeight) + (padding * 2) + 30;
      
      let svg = '<svg width="' + width + '" height="' + height + '" style="border:1px solid #ddd; background:#fafafa; margin:10px 0">';
      
      // Render connections
      for (let i = 0; i < stageNames.length - 1; i++) {
        const x1 = (i * stageWidth) + stageWidth + padding;
        const x2 = ((i + 1) * stageWidth) + padding;
        const y = (height / 2);
        svg += '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="#ccc" stroke-width="2" />';
      }
      
      // Render stages and jobs
      stageNames.forEach((stageName, stageIdx) => {
        const x = (stageIdx * stageWidth) + padding;
        const jobs = stages[stageName];
        
        // Stage label
        svg += '<text x="' + (x + stageWidth/2) + '" y="' + (padding - 5) + '" text-anchor="middle" font-size="12" font-weight="bold">' + stageName + '</text>';
        
        // Jobs in this stage
        jobs.forEach((job, jobIdx) => {
          const y = padding + 20 + (jobIdx * jobHeight);
          
          let color = '#ccc';
          if (job.status === 'success') color = '#16a34a';
          else if (job.status === 'failed') color = '#dc2626';
          else if (job.status === 'running') color = '#2563eb';
          else if (job.status === 'pending') color = '#facc15';
          else if (job.status === 'canceled') color = '#6b7280';
          else if (job.status === 'skipped') color = '#9ca3af';
          
          svg += '<rect x="' + x + '" y="' + y + '" width="' + (stageWidth - 10) + '" height="' + (jobHeight - 5) + '" fill="' + color + '" rx="4" />';
          svg += '<text x="' + (x + (stageWidth - 10)/2) + '" y="' + (y + (jobHeight - 5)/2 + 4) + '" text-anchor="middle" font-size="11" fill="white">' + job.name + '</text>';
          
          svg += '<title>' + job.stage + ': ' + job.name + ' (' + job.status + ')</title>';
        });
      });
      
      svg += '</svg>';
      
      return '<a href="' + pipeline.web_url + '" target="_blank" style="display:block">' + svg + '</a>';
    }

    function switchView(view) {
      currentView = view;
      window.location.hash = view;
      
      // Update button states
      document.querySelectorAll('.view-toggle button').forEach(btn => {
        btn.classList.remove('active');
      });
      document.querySelector('[onclick*="' + view + '"]').classList.add('active');
      
      // Switch views
      const listView = document.getElementById('list-view');
      const graphView = document.getElementById('graph-view');
      
      if (view === 'list') {
        listView.classList.add('active');
        graphView.classList.remove('active');
      } else {
        listView.classList.remove('active');
        graphView.classList.add('active');
      }
    }

    async function loadData(force = false) {
      const cacheInfo = document.getElementById('cache-info');
      const refreshBtn = document.getElementById('refresh-btn');
      
      refreshBtn.disabled = true;
      
      // Show loading with progress
      const listView = document.getElementById('list-view');
      const graphView = document.getElementById('graph-view');
      const targetView = currentView === 'list' ? listView : graphView;
      
      const includeJobs = currentView === 'graph';
      
      // Check if we have cache to determine if this is a first load
      const checkResponse = await fetch('/api/pipelines?includeJobs=' + includeJobs);
      const checkData = await checkResponse.json();
      const isFirstLoad = !checkData.cached;
      
      if (isFirstLoad && !force) {
        targetView.innerHTML = '<div class="loading"><div class="spinner"></div><div id="progress-message">⚠️ Primera carga sin caché, esto puede demorar varios segundos...</div></div>';
      } else {
        targetView.innerHTML = '<div class="loading"><div class="spinner"></div><div id="progress-message">Initializing...</div></div>';
      }
      
      try {
        const eventSource = new EventSource('/api/pipelines/stream?force=' + force + '&includeJobs=' + includeJobs);
        
        eventSource.addEventListener('progress', (e) => {
          const data = JSON.parse(e.data);
          const progressEl = document.getElementById('progress-message');
          if (progressEl) {
            progressEl.textContent = data.message;
          }
        });
        
        eventSource.addEventListener('complete', (e) => {
          const result = JSON.parse(e.data);
          eventSource.close();
          
          // Update cache info
          if (result.cached && result.cacheAge !== null) {
            let cacheText = 'Cached (' + result.cacheAge + 's ago)';
            if (result.cacheDuration) {
              cacheText += ' - último refrescó demoró ' + result.cacheDuration.toFixed(1) + 's';
            }
            cacheInfo.textContent = cacheText;
          } else {
            let cacheText = 'Fresh data';
            if (result.cacheDuration) {
              cacheText += ' - fetch demoró ' + result.cacheDuration.toFixed(1) + 's';
            }
            cacheInfo.textContent = cacheText;
          }
          
          cachedData = result.data;
          renderData(result.data);
          refreshBtn.disabled = false;
        });
        
        eventSource.addEventListener('error', (e) => {
          eventSource.close();
          targetView.innerHTML = '<div class="error-message">Failed to load data. Please try again.</div>';
          refreshBtn.disabled = false;
        });
        
      } catch (error) {
        targetView.innerHTML = '<div class="error-message">Failed to load data: ' + error.message + '</div>';
        refreshBtn.disabled = false;
      }
    }
    
    function renderData(servers) {
      const stats = document.getElementById('stats');
      
      // Calculate statistics
      let totalProjects = 0;
      let totalBranches = 0;
      let statusCounts = {};
      
      servers.forEach(server => {
        totalProjects += server.projects.length;
        server.projects.forEach(project => {
          totalBranches += project.branches.length;
          project.branches.forEach(branch => {
            if (branch.pipeline) {
              const status = branch.pipeline.status;
              statusCounts[status] = (statusCounts[status] || 0) + 1;
            }
          });
        });
      });
      
      // Render stats
      stats.innerHTML = \`
        <div class="stat-card">
          <div class="stat-value">\${servers.length}</div>
          <div class="stat-label">Servers</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${totalProjects}</div>
          <div class="stat-label">Projects</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${totalBranches}</div>
          <div class="stat-label">Branches</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${statusCounts.success || 0}</div>
          <div class="stat-label">Success</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${statusCounts.failed || 0}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${statusCounts.running || 0}</div>
          <div class="stat-label">Running</div>
        </div>
      \`;
      
      // Render appropriate view
      if (currentView === 'list') {
        renderListView(servers);
      } else {
        renderGraphView(servers);
      }
    }

    function renderListView(servers) {
      const content = document.getElementById('list-view');
      
      // Render servers and projects
      content.innerHTML = servers.map(server => \`
        <div class="server-section">
          <h2>\${server.serverName}</h2>
          \${server.projects.map(project => \`
            <div class="project-card \${project.error ? 'has-error' : ''}">
              <div class="project-header">
                <div>
                  <div class="project-name">
                    <a href="\${project.url}" target="_blank">\${project.name}</a>
                  </div>
                  <div class="project-path">\${project.path}</div>
                </div>
              </div>
              
              \${project.error ? 
                '<div class="error-message">' + project.error + '</div>' :
                '<div class="branches">' +
                  project.branches.map(branch => \`
                    <div class="branch">
                      <div class="branch-name">\${branch.name}</div>
                      <div class="commit-info">
                        \${branch.commitShortId ? branch.commitShortId + ': ' : ''}\${branch.commitTitle || ''}
                        \${branch.error ? '<span class="error-message">' + branch.error + '</span>' : ''}
                      </div>
                      <div>
                        \${branch.pipeline ? 
                          '<a href="' + branch.pipeline.web_url + '" target="_blank" class="pipeline-status status-' + branch.pipeline.status + '">' + 
                          branch.pipeline.status + 
                          '</a>' :
                          '<span class="pipeline-status status-none">No pipeline</span>'
                        }
                      </div>
                    </div>
                  \`).join('') +
                '</div>'
              }
            </div>
          \`).join('')}
        </div>
      \`).join('');
    }

    function renderGraphView(servers) {
      const content = document.getElementById('graph-view');
      
      content.innerHTML = servers.map(server => {
        // Group projects by status
        const projectsByStatus = {
          success: [],
          failed: [],
          running: [],
          other: []
        };
        
        server.projects.forEach(project => {
          if (project.error) {
            projectsByStatus.other.push(project);
            return;
          }
          
          // Determine overall project status based on branches
          const statuses = project.branches
            .map(b => b.pipeline?.status)
            .filter(s => s);
          
          if (statuses.some(s => s === 'failed')) {
            projectsByStatus.failed.push(project);
          } else if (statuses.some(s => s === 'running')) {
            projectsByStatus.running.push(project);
          } else if (statuses.every(s => s === 'success')) {
            projectsByStatus.success.push(project);
          } else {
            projectsByStatus.other.push(project);
          }
        });
        
        return \`
          <div class="server-section">
            <h2>\${server.serverName}</h2>
            <div class="project-graph">
              \${Object.entries(projectsByStatus).map(([status, projects]) => 
                projects.map(project => {
                  const mainStatus = status === 'other' ? '' : 'status-' + status;
                  return \`
                    <div class="graph-node \${mainStatus}">
                      <div class="graph-node-title">
                        <a href="\${project.url}" target="_blank">\${project.name}</a>
                      </div>
                      <div class="graph-node-branches">
                        \${project.branches.slice(0, 3).map(branch => \`
                          <div class="graph-branch">
                            <div class="graph-branch-name">\${branch.name}</div>
                            \${branch.pipeline ? renderPipelineSVG(branch.pipeline) : '<span class="pipeline-status status-none" title="No pipeline">No pipeline</span>'}
                          </div>
                        \`).join('')}
                        \${project.branches.length > 3 ? 
                          '<div style="font-size: 0.8rem; color: #666; margin-top: 0.5rem;">+ ' + 
                          (project.branches.length - 3) + ' more branches</div>' : 
                          ''
                        }
                      </div>
                    </div>
                  \`;
                }).join('')
              ).join('')}
            </div>
          </div>
        \`;
      }).join('');
    }
    
    // Initial load
    loadData(false);
    
    // Auto-refresh every 60 seconds
    autoRefreshInterval = setInterval(() => loadData(false), 60000);
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║       GitLab Pipeline Monitor - Web Interface          ║
║                                                        ║
║       Server running at: http://localhost:${PORT}       ║
║                                                        ║
║       Open your browser and navigate to the URL       ║
║       above to view your pipeline status.              ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});
