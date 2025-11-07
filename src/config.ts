import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Config } from './types';

export function loadConfig(configPath: string = 'config.yaml'): Config {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents) as Config;

    // Validate config
    if (!config.servers || config.servers.length === 0) {
      throw new Error('No servers configured');
    }

    for (const server of config.servers) {
      if (!server.url || !server.token) {
        throw new Error(`Server "${server.name}" missing url or token`);
      }

      const hasProjects = server.projects && server.projects.length > 0;
      const hasGroups = server.groups && server.groups.length > 0;

      if (!hasProjects && !hasGroups) {
        throw new Error(
          `Server "${server.name}" has no projects or groups configured. ` +
          'Please specify at least one project or group.'
        );
      }
    }

    // Set defaults
    config.refreshInterval = config.refreshInterval || 30;
    config.display = config.display || {};
    config.display.recentOnly = config.display.recentOnly ?? false;
    config.display.pipelinesPerBranch = config.display.pipelinesPerBranch || 1;
    config.display.compact = config.display.compact ?? false;

    // Set cache TTL defaults (in seconds)
    config.cache = config.cache || {};
    config.cache.groupsProjects = config.cache.groupsProjects ?? 1800; // 30 minutes
    config.cache.branches = config.cache.branches ?? 300;              // 5 minutes
    config.cache.pipelines = config.cache.pipelines ?? 5;              // 5 seconds

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Config file not found: ${configPath}\n` +
        'Please copy config.example.yaml to config.yaml and configure it.'
      );
    }
    throw error;
  }
}
