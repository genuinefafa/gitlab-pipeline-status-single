/**
 * Rutas SSE — Conexión de eventos en tiempo real y manejo de suscripciones.
 *
 * GET  /api/events?clientId=xxx  → Stream SSE
 * POST /api/subscribe            → Agregar/quitar suscripciones de branches
 */

import { Hono } from 'hono';
import { SSEManager } from '../sse-manager.ts';
import { GitLabPoller } from '../poller.ts';

// Instancias singleton exportadas para que otros módulos puedan usarlas
export const sseManager = new SSEManager();
import { config } from '../config.ts';
export const poller = new GitLabPoller(sseManager, config.refreshInterval * 1000);

const app = new Hono();

/**
 * GET /api/events?clientId=xxx
 *
 * Establece una conexión SSE con el cliente.
 * El clientId debe ser único por pestaña/conexión.
 */
app.get('/api/events', (c) => {
  const clientId = c.req.query('clientId');
  if (!clientId) {
    return c.json({ error: 'clientId required' }, 400);
  }

  const stream = new ReadableStream({
    start(controller) {
      sseManager.addClient(clientId, controller);

      // Enviar evento de confirmación de conexión
      sseManager.pushToClient(clientId, {
        type: 'connected',
        data: { clientId },
      });
    },
    cancel() {
      // El cliente cerró la conexión
      sseManager.removeClient(clientId);

      // Si no quedan clientes, parar el poller para no gastar requests
      if (sseManager.clientCount === 0) {
        poller.stop();
      }
    },
  });

  // Arrancar el poller si no está corriendo y hay al menos un cliente
  if (!poller.isRunning) {
    poller.start();
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Para nginx/proxies que bufferean
    },
  });
});

/**
 * POST /api/subscribe
 *
 * Body: { clientId: string, add?: string[], remove?: string[] }
 *
 * Permite a un cliente agregar o quitar suscripciones a branches.
 * Las branches usan el formato "grupo/proyecto:rama".
 */
app.post('/api/subscribe', async (c) => {
  let body: { clientId?: string; add?: string[]; remove?: string[] };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON inválido' }, 400);
  }

  const { clientId, add, remove } = body;

  if (!clientId) {
    return c.json({ error: 'clientId required' }, 400);
  }

  if (add?.length) {
    sseManager.subscribe(clientId, add);
  }

  if (remove?.length) {
    sseManager.unsubscribe(clientId, remove);
  }

  return c.json({
    ok: true,
    watching: sseManager.getClientBranches(clientId),
  });
});

export default app;
