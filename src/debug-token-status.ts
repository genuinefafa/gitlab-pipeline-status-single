import { loadConfig } from './config';
import { tokenManager } from './api-routes-htmx';

async function main() {
  try {
    const config = loadConfig();
    console.log('\n🔐 Debug Token Status Script');
    console.log(`Loaded config with ${config.servers.length} server(s)`);
    for (const server of config.servers) {
      console.log(`\nValidating tokens for server: ${server.name}`);
      const results = await tokenManager.validateServerTokens(server);
      for (const r of results) {
        console.log(`  → ${r.token.name}: ${r.health.status} (${r.health.message})`);
      }
    }
    const status = tokenManager.getAllTokenStatus();
    const hasWarnings = tokenManager.hasWarnings();
    const payload = { ok: !hasWarnings, servers: status };
    console.log('\nJSON Output:\n');
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('❌ Failed to produce token status JSON:', (err as Error).message);
    process.exit(1);
  }
}

main();
