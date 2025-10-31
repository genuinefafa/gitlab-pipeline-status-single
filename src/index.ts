#!/usr/bin/env node

import { loadConfig } from './config';
import { GitLabClient } from './gitlab';
import { UI } from './ui';
import { TreeData, ProjectTreeNode } from './types';

class GitLabMonitor {
  private ui: UI;
  private config: ReturnType<typeof loadConfig>;
  private refreshTimer?: NodeJS.Timeout;
  private lastUpdate: Date = new Date();
  private nextUpdate: Date = new Date();
  private isRefreshing = false;

  constructor(configPath?: string) {
    try {
      this.config = loadConfig(configPath);
      this.ui = new UI();
    } catch (error) {
      console.error('Failed to load configuration:');
      console.error((error as Error).message);
      process.exit(1);
    }
  }

  async start() {
    console.log('Starting GitLab Pipeline Status Monitor...');
    console.log(`Monitoring ${this.config.servers.length} server(s)`);
    console.log(`Refresh interval: ${this.config.refreshInterval}s\n`);

    // Initial fetch
    await this.refresh();

    // Set up auto-refresh
    this.scheduleNextRefresh();
  }

  private scheduleNextRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.nextUpdate = new Date(Date.now() + this.config.refreshInterval * 1000);

    this.refreshTimer = setTimeout(async () => {
      await this.refresh();
      this.scheduleNextRefresh();
    }, this.config.refreshInterval * 1000);
  }

  async refresh() {
    if (this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    this.ui.showLoading('Fetching pipeline data...');

    try {
      const allData: TreeData[] = [];

      for (const server of this.config.servers) {
        const client = new GitLabClient(server.url, server.token);
        const projects: ProjectTreeNode[] = [];

        // Collect all project configs from both individual projects and groups
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
              // Convert fetched projects to ProjectConfig format
              const projectConfigs = groupProjects.map((project) => ({
                id: project.id,
                name: project.name,
                path: project.path_with_namespace,
              }));
              allProjectConfigs.push(...projectConfigs);
            } catch (error) {
              // If group fetch fails, add an error entry
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
            const data = await client.getProjectPipelineData(projectConfig);
            return {
              name: projectConfig.name || data.project.name,
              path: data.project.path_with_namespace,
              url: data.project.web_url,
              branches: data.branches,
            };
          } catch (error) {
            return {
              name: projectConfig.name || projectConfig.path || `Project ${projectConfig.id}`,
              path: projectConfig.path || `ID: ${projectConfig.id}`,
              url: '',
              branches: [],
              error: (error as Error).message,
            };
          }
        });

        const projectResults = await Promise.all(projectPromises);
        projects.push(...projectResults);

        allData.push({
          serverName: server.name,
          projects,
        });
      }

      this.lastUpdate = new Date();
      this.ui.render(allData, this.lastUpdate, this.nextUpdate);
    } catch (error) {
      this.ui.showError((error as Error).message);
    } finally {
      this.isRefreshing = false;
    }
  }

  stop() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const configPath = args[0];

// Create and start monitor
const monitor = new GitLabMonitor(configPath);

// Handle graceful shutdown
process.on('SIGINT', () => {
  monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  monitor.stop();
  process.exit(0);
});

// Start monitoring
monitor.start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
