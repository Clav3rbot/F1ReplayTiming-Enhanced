/**
 * Cloudflare Worker — F1 SignalR & Static Data proxy
 *
 * Proxies HTTP negotiate, WebSocket connections, and static JSON data to
 * livetiming.formula1.com.
 *
 * Deploy once on the free tier (workers.dev).
 * Set F1_SIGNALR_PROXY=https://<your-worker>.workers.dev in your .env.
 *
 * Lock it down: add a secret named PROXY_KEY to the worker (Settings →
 * Variables and Secrets) and set the same value as F1_SIGNALR_PROXY_KEY in
 * the backend. Without it the worker is an open proxy anyone can use to
 * exhaust your daily quota. Requests without a matching X-Proxy-Key get 403.
 *
 * Free tier limits (more than enough for personal use):
 *   100 000 requests/day, unlimited WebSocket duration
 */

const F1_HOST = "livetiming.formula1.com";

export default {
  async fetch(request, env) {
    if (env.PROXY_KEY && request.headers.get("X-Proxy-Key") !== env.PROXY_KEY) {
      return new Response("Forbidden", { status: 403 });
    }
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade") || "";

    if (upgradeHeader.toLowerCase() === "websocket") {
      return proxyWebSocket(request, url);
    }

    return proxyHttp(request, url);
  },
};

// ---------------------------------------------------------------------------
// HTTP (negotiate POST + OPTIONS + static JSON data)
// ---------------------------------------------------------------------------

async function proxyHttp(request, url) {
  const isStatic = url.pathname.startsWith("/static");
  const target = isStatic
    ? `https://${F1_HOST}${url.pathname}${url.search}`
    : `https://${F1_HOST}/signalrcore${url.pathname}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const lower = k.toLowerCase();
    // drop hop-by-hop and host headers
    if (["host", "cf-connecting-ip", "cf-ray", "cf-visitor",
         "x-forwarded-for", "x-real-ip", "x-proxy-key"].includes(lower)) continue;
    headers.set(k, v);
  }
  headers.set("Host", F1_HOST);

  const resp = await fetch(target, {
    method:  request.method,
    headers,
    body:    request.method === "GET" || request.method === "HEAD"
               ? undefined
               : request.body,
  });

  // Pass CORS headers back so the browser can also call this directly
  const out = new Headers(resp.headers);
  out.set("Access-Control-Allow-Origin", "*");
  out.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  out.set("Access-Control-Allow-Headers", "*");

  return new Response(resp.body, { status: resp.status, headers: out });
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

async function proxyWebSocket(request, url) {
  const isStatic = url.pathname.startsWith("/static");
  // CF Workers: use https:// scheme + Upgrade header (wss:// scheme alone is insufficient)
  const target = isStatic
    ? `https://${F1_HOST}${url.pathname}${url.search}`
    : `https://${F1_HOST}/signalrcore${url.pathname}${url.search}`;

  // Connect to the F1 backend WebSocket
  const f1Headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const lower = k.toLowerCase();
    if (["host", "cf-connecting-ip", "cf-ray", "cf-visitor",
         "x-forwarded-for", "x-real-ip", "x-proxy-key"].includes(lower)) continue;
    if (lower === "upgrade" || lower === "connection") continue;
    f1Headers.set(k, v);
  }
  f1Headers.set("Host", F1_HOST);
  // Required by CF Workers runtime to initiate WebSocket upgrade to upstream
  f1Headers.set("Upgrade", "websocket");
  f1Headers.set("Connection", "Upgrade");

  let f1Resp;
  try {
    f1Resp = await fetch(target, { headers: f1Headers });
  } catch (err) {
    return new Response(`Worker: F1 WebSocket connect failed: ${err}`, { status: 502 });
  }

  if (f1Resp.status !== 101) {
    return new Response(`Worker: F1 WebSocket upgrade rejected: ${f1Resp.status}`, { status: 502 });
  }

  const f1Ws = f1Resp.webSocket;
  if (!f1Ws) {
    return new Response("Worker: no WebSocket object from F1", { status: 502 });
  }

  // Create WebSocket pair: client <-> worker <-> F1
  const { 0: clientWs, 1: serverWs } = new WebSocketPair();

  f1Ws.accept();
  serverWs.accept();

  // Pipe F1 → client
  f1Ws.addEventListener("message", (ev) => {
    try { serverWs.send(ev.data); } catch {}
  });
  f1Ws.addEventListener("close", (ev) => {
    try { serverWs.close(ev.code, ev.reason); } catch {}
  });

  // Pipe client → F1
  serverWs.addEventListener("message", (ev) => {
    try { f1Ws.send(ev.data); } catch {}
  });
  serverWs.addEventListener("close", (ev) => {
    try { f1Ws.close(ev.code, ev.reason); } catch {}
  });

  return new Response(null, { status: 101, webSocket: clientWs });
}
