#!/bin/sh
# Replace the build-time placeholder with the runtime NEXT_PUBLIC_API_URL.
# If NEXT_PUBLIC_API_URL is not set, default to http://localhost:8000.
RUNTIME_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"
PLACEHOLDER="__NEXT_PUBLIC_API_URL__"

if [ "$RUNTIME_URL" != "$PLACEHOLDER" ]; then
  find /app/.next -name "*.js" -exec sed -i "s|$PLACEHOLDER|$RUNTIME_URL|g" {} +
  echo "Configured API URL: $RUNTIME_URL"
fi

exec "$@"
