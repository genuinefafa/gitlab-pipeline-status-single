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
            
            // If pipeline exists, fetch its jobs
            if (pipeline) {
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
      padding: 2rem;
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
      display: inline-block;
    }
    
    .status-success { background: #16a34a; color: #fff; }
    .status-failed { background: #dc2626; color: #fff; }
    .status-running { background: #2563eb; color: #fff; }
    .status-pending { background: #ca8a04; color: #fff; }
    .status-canceled { background: #6b7280; color: #fff; }
    .status-skipped { background: #6b7280; color: #fff; }
    .status-manual { background: #9333ea; color: #fff; }
    .status-created { background: #6b7280; color: #fff; }
    .status-waiting_for_resource { background: #ea580c; color: #fff; }
    .status-preparing { background: #ea580c; color: #fff; }
    .status-none { background: #6b7280; color: #fff; }
    
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
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
    }

    .graph-node {
      padding: 1rem;
      border: 1px solid #ddd;
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
                            <div class="graph-branch-name">\${branch.name}</div>
                            \${branch.pipeline ? 
                              '<a href="' + branch.pipeline.web_url + '" target="_blank" class="pipeline-status status-' + branch.pipeline.status + '">' + 
                              branch.pipeline.status + 
                              '</a>' :
                              '<span class="pipeline-status status-none">No pipeline</span>'
                            }
                            \${branch.pipeline && branch.pipeline.jobs && branch.pipeline.jobs.length > 0 ?
                              '<div class="pipeline-jobs">' +
                              branch.pipeline.jobs.map(job => 
                                '<span class="job-badge ' + job.status + '">' + job.name + '</span>'
                              ).join('') +
                              '</div>' : ''
                            }
                          </div>
                        \`).join('')}
                        \${project.branches.length > 5 ? 
                          '<div style="font-size: 0.8rem; color: #666; margin-top: 0.5rem;">+ ' + 
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
