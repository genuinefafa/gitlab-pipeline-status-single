import { Hono } from 'hono';
import { logger } from './logger.ts';
const log = logger('Server');
import { serveStatic } from 'hono/bun';
import { config } from './config.ts';
import apiRoutes, { tokenManager } from './routes/api.ts';
import healthRoutes from './routes/health.ts';
import eventsRoutes from './routes/events.ts';

const app = new Hono();

// Rutas API (antes de static para que no las intercepte el wildcard)
app.route('/', apiRoutes);
app.route('/', healthRoutes);
app.route('/', eventsRoutes);

// Rutas HTML
app.get('/', (c) => c.redirect('/index.html'));
app.get('/about', (c) => c.redirect('/about.html'));

// Archivos estáticos (al final, como fallback)
app.use('/*', serveStatic({ root: './public' }));

// Validar tokens al inicio
log.info( 'GitLab Pipeline Status v2');
log.info( `${config.servers.length} servidor(es) GitLab configurado(s)`);
log.info( 'Validando tokens...');

for (const server of config.servers) {
  await tokenManager.validateServerTokens(server);
}

if (tokenManager.hasWarnings()) {
  log.warn( 'Algunos tokens están por vencer o son inválidos');
} else {
  log.info( 'Todos los tokens son válidos');
}

log.info( 'Escuchando en http://localhost:3000');

export default {
  port: 3000,
  fetch: app.fetch,
  idleTimeout: 120, // segundos — SSE necesita conexiones idle largas
};
