// ⚠️ LEGACY FILE - NO LONGER USED
// This project previously used Vite dev server with proxy to separate Express API server.
// Architecture was simplified to use single Express server on port 3000.
//
// Kept for historical reference only. Can be safely deleted.
//
// Current architecture: Express serves both static files and API on port 3000
// See ARCHITECTURE.md for details.

import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});