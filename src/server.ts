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
 * Fetch fresh pipeline data from GitLab
 */
async function fetchPipelineData(): Promise<TreeData[]> {
  const allData: TreeData[] = [];

  for (const server of config.servers) {
    const client = new GitLabClient(server.url, server.token);
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
        const branches = await client.getBranches(project.id);

        const branchPromises = branches.map(async (branch) => {
          try {
            const pipeline = await client.getLatestPipeline(project.id, branch.name);
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

    projects.push(...(await Promise.all(projectPromises)));

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

  try {
    // Try to get from cache first
    let data = cache.get(force);

    if (!data) {
      // Fetch fresh data
      data = await fetchPipelineData();
      cache.set(data);
    }

    const cacheAge = cache.getAge();

    res.json({
      data,
      cached: !force && cacheAge !== null,
      cacheAge,
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
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/dark.css">
  <style>
    body {
      max-width: 1400px;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }
    
    .controls {
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    
    .loading {
      text-align: center;
      padding: 2rem;
      font-size: 1.2rem;
    }
    
    .server-section {
      margin-bottom: 3rem;
      border: 1px solid #444;
      padding: 1.5rem;
      border-radius: 8px;
    }
    
    .server-section h2 {
      margin-top: 0;
      border-bottom: 2px solid #666;
      padding-bottom: 0.5rem;
    }
    
    .project-card {
      margin-bottom: 2rem;
      border-left: 4px solid #555;
      padding-left: 1rem;
    }
    
    .project-card.has-error {
      border-left-color: #ff6b6b;
    }
    
    .project-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    
    .project-name {
      font-size: 1.3rem;
      font-weight: bold;
      margin-bottom: 0.3rem;
    }
    
    .project-path {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    
    .branches {
      display: grid;
      gap: 0.8rem;
      margin-left: 1rem;
    }
    
    .branch {
      display: grid;
      grid-template-columns: 150px 1fr auto;
      gap: 1rem;
      align-items: center;
      padding: 0.8rem;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 4px;
    }
    
    .branch-name {
      font-weight: 600;
      font-family: monospace;
    }
    
    .commit-info {
      font-size: 0.9rem;
      color: #aaa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .pipeline-status {
      padding: 0.3rem 0.8rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      white-space: nowrap;
    }
    
    .status-success { background: #51cf66; color: #000; }
    .status-failed { background: #ff6b6b; color: #fff; }
    .status-running { background: #4dabf7; color: #fff; }
    .status-pending { background: #ffd43b; color: #000; }
    .status-canceled { background: #868e96; color: #fff; }
    .status-skipped { background: #868e96; color: #fff; }
    .status-manual { background: #cc5de8; color: #fff; }
    .status-created { background: #868e96; color: #fff; }
    .status-waiting_for_resource { background: #fd7e14; color: #fff; }
    .status-preparing { background: #fd7e14; color: #fff; }
    .status-none { background: #495057; color: #aaa; }
    
    .error-message {
      color: #ff6b6b;
      font-style: italic;
      padding: 0.5rem;
      background: rgba(255, 107, 107, 0.1);
      border-radius: 4px;
    }
    
    .cache-info {
      font-size: 0.9rem;
      color: #888;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .stat-card {
      padding: 1rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      text-align: center;
    }
    
    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      margin-bottom: 0.3rem;
    }
    
    .stat-label {
      font-size: 0.9rem;
      color: #888;
      text-transform: uppercase;
    }

    a {
      color: #4dabf7;
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }

    .view-toggle {
      margin-bottom: 1rem;
      display: flex;
      gap: 0.5rem;
    }

    .view-toggle button {
      padding: 0.5rem 1rem;
    }

    .view-toggle button.active {
      background: #4dabf7;
      color: #000;
    }

    .graph-view {
      display: none;
    }

    .graph-view.active {
      display: block;
    }

    .list-view.active {
      display: block;
    }

    .project-graph {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      padding: 1rem;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 8px;
    }

    .graph-node {
      min-width: 250px;
      padding: 1rem;
      background: rgba(255, 255, 255, 0.05);
      border: 2px solid #555;
      border-radius: 8px;
      position: relative;
    }

    .graph-node.status-success {
      border-color: #51cf66;
    }

    .graph-node.status-failed {
      border-color: #ff6b6b;
    }

    .graph-node.status-running {
      border-color: #4dabf7;
    }

    .graph-node-title {
      font-weight: bold;
      margin-bottom: 0.5rem;
      font-size: 1.1rem;
    }

    .graph-node-branches {
      font-size: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .graph-branch {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.3rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 3px;
    }

    .graph-branch-status {
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
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
  <div id="list-view" class="list-view active"></div>
  <div id="graph-view" class="graph-view"></div>

  <script>
    let autoRefreshInterval = null;
    let currentView = 'list';
    let cachedData = null;

    function switchView(view) {
      currentView = view;
      document.querySelectorAll('.view-toggle button').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      
      if (view === 'list') {
        document.getElementById('list-view').classList.add('active');
        document.getElementById('graph-view').classList.remove('active');
      } else {
        document.getElementById('list-view').classList.remove('active');
        document.getElementById('graph-view').classList.add('active');
      }
      
      if (cachedData) {
        if (view === 'list') {
          renderListView(cachedData);
        } else {
          renderGraphView(cachedData);
        }
      }
    }

    async function loadData(force = false) {
      const cacheInfo = document.getElementById('cache-info');
      const refreshBtn = document.getElementById('refresh-btn');
      
      refreshBtn.disabled = true;
      
      try {
        const response = await fetch('/api/pipelines?force=' + force);
        const result = await response.json();
        
        if (result.error) {
          document.getElementById('list-view').innerHTML = '<div class="error-message">Error: ' + result.message + '</div>';
          return;
        }
        
        // Update cache info
        if (result.cached && result.cacheAge !== null) {
          cacheInfo.textContent = 'Cached (' + result.cacheAge + 's ago)';
        } else {
          cacheInfo.textContent = 'Fresh data';
        }
        
        cachedData = result.data;
        renderData(result.data);
      } catch (error) {
        document.getElementById('list-view').innerHTML = '<div class="error-message">Failed to load data: ' + error.message + '</div>';
      } finally {
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
                        \${project.branches.slice(0, 5).map(branch => \`
                          <div class="graph-branch">
                            <span>\${branch.name}</span>
                            \${branch.pipeline ? 
                              '<span class="graph-branch-status pipeline-status status-' + branch.pipeline.status + '">' + 
                              branch.pipeline.status + 
                              '</span>' :
                              '<span class="graph-branch-status pipeline-status status-none">-</span>'
                            }
                          </div>
                        \`).join('')}
                        \${project.branches.length > 5 ? 
                          '<div style="font-size: 0.8rem; color: #888; margin-top: 0.3rem;">+ ' + 
                          (project.branches.length - 5) + ' more branches</div>' : 
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
