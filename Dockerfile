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

RUN mkdir -p /data/fastf1-cache

EXPOSE 8000
ENV PORT=8000
ENV STATIC_DIR=/app/static

CMD sh -c "cp -n /app/data/pit_loss.json /data/pit_loss.json 2>/dev/null; uvicorn main:app --host 0.0.0.0 --port $PORT"
