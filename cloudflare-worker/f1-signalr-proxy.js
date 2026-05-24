/**
 * Cloudflare Worker — F1 SignalR proxy
 *
 * Proxies HTTP negotiate and WebSocket connections to
 * livetiming.formula1.com/signalrcore.
 *
 * Deploy once on the free tier (workers.dev).
 * Set F1_SIGNALR_PROXY=https://<your-worker>.workers.dev in your .env.
 *
 * Free tier limits (more than enough for personal use):
 *   100 000 requests/day, unlimited WebSocket duration
 */

const F1_HOST = "livetiming.formula1.com";
const F1_BASE = `https://${F1_HOST}/signalrcore`;
const F1_WS   = `wss://${F1_HOST}/signalrcore`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade") || "";

    if (upgradeHeader.toLowerCase() === "websocket") {
      return proxyWebSocket(request, url);
    }

    return proxyHttp(request, url);
  },
};

// ---------------------------------------------------------------------------
// HTTP (negotiate POST + OPTIONS)
// ---------------------------------------------------------------------------

async function proxyHttp(request, url) {
  const target = `${F1_BASE}${url.pathname}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const lower = k.toLowerCase();
    // drop hop-by-hop and host headers
    if (["host", "cf-connecting-ip", "cf-ray", "cf-visitor",
         "x-forwarded-for", "x-real-ip"].includes(lower)) continue;
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
  const target = `${F1_WS}${url.pathname}${url.search}`;

  // Connect to the F1 backend WebSocket
  const f1Headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const lower = k.toLowerCase();
    if (["host", "cf-connecting-ip", "cf-ray", "cf-visitor",
         "x-forwarded-for", "x-real-ip"].includes(lower)) continue;
    if (lower === "upgrade" || lower === "connection") continue;
    f1Headers.set(k, v);
  }
  f1Headers.set("Host", F1_HOST);

  const f1Resp = await fetch(target, {
    headers: f1Headers,
  });

  if (f1Resp.status !== 101) {
    return new Response("F1 WebSocket upgrade failed", { status: 502 });
  }

  const f1Ws = f1Resp.webSocket;
  if (!f1Ws) {
    return new Response("No WebSocket from F1", { status: 502 });
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
