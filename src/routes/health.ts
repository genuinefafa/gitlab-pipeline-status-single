import { Hono } from 'hono';
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
    console.error('Error en /api/token-status:', (error as Error).message);
    return c.json({ error: 'Error al validar tokens', message: (error as Error).message }, 500);
  }
});

export default health;
