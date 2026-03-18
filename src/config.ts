import * as yaml from 'js-yaml';
import { Config } from './types.ts';

export async function loadConfig(configPath: string = 'config.yaml'): Promise<Config> {
  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();

    if (!exists) {
      throw new Error(
        `Config file not found: ${configPath}\n` +
        'Please copy config.example.yaml to config.yaml and configure it.'
      );
    }

    const fileContents = await file.text();
    const config = yaml.load(fileContents) as Config;

    // Validar config
    if (!config.servers || config.servers.length === 0) {
      throw new Error('No servers configured');
    }

    for (const server of config.servers) {
      if (!server.url) {
        throw new Error(`Server "${server.name}" missing url`);
      }

      // Validar tokens: soporta legacy single token o nuevo tokens array
      const hasLegacyToken = !!server.token;
      const hasNewTokens = server.tokens && server.tokens.length > 0;

      if (!hasLegacyToken && !hasNewTokens) {
        throw new Error(`Server "${server.name}" missing token or tokens array`);
      }

      // Si usa nuevo tokens array, validar cada token
      if (hasNewTokens) {
        for (const token of server.tokens!) {
          if (!token.value) {
            throw new Error(`Server "${server.name}" has token without value`);
          }
        }
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

    // Defaults
    config.refreshInterval = config.refreshInterval || 30;
    config.display = config.display || {};
    config.display.recentOnly = config.display.recentOnly ?? false;
    config.display.pipelinesPerBranch = config.display.pipelinesPerBranch || 1;
    config.display.compact = config.display.compact ?? false;

    // Cache TTL defaults (en segundos)
    config.cache = config.cache || {};
    config.cache.groupsProjects = config.cache.groupsProjects ?? 1800; // 30 minutos
    config.cache.branches = config.cache.branches ?? 300;              // 5 minutos
    config.cache.pipelines = config.cache.pipelines ?? 5;              // 5 segundos

    return config;
  } catch (error) {
    // Re-throw errores propios
    throw error;
  }
}

// Carga la config al inicio del módulo
export const config = await loadConfig();
