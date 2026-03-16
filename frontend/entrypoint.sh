#!/bin/sh
RUNTIME_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"
PLACEHOLDER="__NEXT_PUBLIC_API_URL__"

if [ "$RUNTIME_URL" != "$PLACEHOLDER" ]; then
  find /app/.next -name "*.js" | while read f; do
    sed "s|$PLACEHOLDER|$RUNTIME_URL|g" "$f" > /tmp/sedtmp && mv /tmp/sedtmp "$f" || true
  done
  echo "Configured API URL: $RUNTIME_URL"
fi

exec "$@"