import { Hono } from 'hono';
import { logger } from '../logger.ts';
const log = logger('Health');
import { config } from '../config.ts';
import { tokenManager } from './api.ts';

const health = new Hono();

/**
 * GET /api/token-status
 * Valida tokens y devuelve estado de salud de cada uno.
 */
health.get('/api/token-status', async (c) => {
  try {
    // Revalidar tokens de todos los servidores
    for (const server of config.servers) {
      await tokenManager.validateServerTokens(server);
    }

    const statuses = tokenManager.getAllTokenStatus();
    const hasWarnings = tokenManager.hasWarnings();

    return c.json({
      healthy: !hasWarnings,
      servers: statuses,
    });
  } catch (error) {
    log.error('Error en /api/token-status:', (error as Error).message);
    return c.json({ error: 'Error al validar tokens', message: (error as Error).message }, 500);
  }
});

/**
 * GET /api/version
 * Info de versión. En dev devuelve placeholders, en Docker se inyecta al build.
 */
health.get('/api/version', (c) => {
  return c.json({
    version: process.env.APP_VERSION || 'dev',
    commit: process.env.APP_COMMIT || 'local',
    buildDate: process.env.APP_BUILD_DATE || new Date().toISOString(),
  });
});

export default health;
