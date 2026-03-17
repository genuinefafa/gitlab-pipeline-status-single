#!/bin/bash
# Verificar que todos los módulos TS se parseen sin errores de sintaxis

MODULES=(
  src/types.ts
  src/cache.ts
  src/config.ts
  src/gitlab.ts
  src/token-manager.ts
  src/sse-manager.ts
  src/poller.ts
  src/routes/api.ts
  src/routes/events.ts
  src/routes/health.ts
)

IMPORTS=""
for mod in "${MODULES[@]}"; do
  IMPORTS+="import './${mod}'; "
done

bun -e "${IMPORTS} console.log('OK: ${#MODULES[@]} módulos verificados');" 2>&1
