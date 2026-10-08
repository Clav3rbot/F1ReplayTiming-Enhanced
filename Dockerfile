# --- Stage 1: Build frontend ---
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build
# Output: /app/frontend/out/

# --- Stage 2: Python backend + frontend static ---
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libheif-dev && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-builder /app/frontend/out /app/static

# Run as an unprivileged user: a bug in the image decoders (sync-photo takes
# untrusted HEIC/PNG) must not hand out root inside the container.
# /app/static stays writable for deployments that inject a script tag at start.
RUN useradd --system --uid 1000 --no-create-home app &&     mkdir -p /data/fastf1-cache &&     chown -R app:app /data /app/static
USER app

EXPOSE 8000
ENV PORT=8000
ENV STATIC_DIR=/app/static
# Persist the FastF1 HTTP cache on the f1cache volume (was /tmp, lost on every deploy)
ENV FASTF1_CACHE_DIR=/data/fastf1-cache

CMD ["sh", "-c", "cp -n /app/data/pit_loss.json /data/pit_loss.json 2>/dev/null; exec uvicorn main:app --host 0.0.0.0 --port $PORT"]
