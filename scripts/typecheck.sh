#!/bin/bash
# Verificar que todos los módulos TS se parseen sin errores de sintaxis

# En CI no hay config.yaml — crear uno temporal si no existe
CREATED_CONFIG=false
if [ ! -f config.yaml ]; then
  cp config.example.yaml config.yaml
  CREATED_CONFIG=true
fi

MODULES=(
  src/types.ts
  src/logger.ts
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
EXIT_CODE=$?

# Limpiar config temporal
if [ "$CREATED_CONFIG" = true ]; then
  rm -f config.yaml
fi

exit $EXIT_CODE
