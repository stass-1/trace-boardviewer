'use strict';

// Local control channel for AI agents (opt-in via TRACE_MCP_BRIDGE=1): a loopback-only HTTP server that
// forwards {method, params} requests to the renderer's board state/actions (src/app/mcp-dispatch.ts) and
// relays the JSON reply back over HTTP. The standalone MCP server in mcp-server/ talks to this.
//
// Why a request/response round trip through the renderer instead of answering from the main process
// directly: the parsed board (Board/BoardIndex) and the selection actions only exist in the renderer's
// Controller (src/app/controller.ts) - the main process never holds board data. The bridge is just a
// relay with an id-correlated pending map.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function startMcpBridge({ getTargetWindow, controlFilePath, log }) {
  // Required lazily, only once this (opt-in, TRACE_MCP_BRIDGE=1) function actually runs: this module is
  // require()'d unconditionally by main.cjs on every launch, and the packaged build's "files" allowlist
  // (package.json) strips all of node_modules except fflate, so a top-level require('ws') would break every
  // ordinary launch of a packaged build, bridge enabled or not. 'ws' stays a devDependency for the same reason.
  const { WebSocketServer } = require('ws');
  const pending = new Map();
  let nextRequestId = 1;
  // The last status pushed by the renderer (src/app/useWorkspace.ts, via 'trace:probe-guide-changed'),
  // so a client that connects after a change still sees where the guide stands, not just the next one.
  let lastProbeGuideStatus = null;

  function handleResponse(payload) {
    if (!payload || typeof payload.id !== 'number') return;
    const entry = pending.get(payload.id);
    if (!entry) return;
    pending.delete(payload.id);
    clearTimeout(entry.timer);
    entry.resolve(payload);
  }

  function callRenderer(method, params, timeoutMs) {
    const win = getTargetWindow();
    if (!win || win.isDestroyed()) return Promise.reject(new Error('NO_WINDOW: TRACE Boardviewer has no open window.'));
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('TIMEOUT: the app did not answer in time.')); }, timeoutMs);
      pending.set(id, { resolve, timer });
      win.webContents.send('trace:mcp-request', { id, method, params });
    }).then((payload) => {
      if (payload.ok === false) throw new Error(payload.error || 'ERROR: unknown failure in the app.');
      return payload.result;
    });
  }

  const token = crypto.randomBytes(24).toString('hex');

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404).end(); return; }
    if (req.headers['authorization'] !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    const chunks = [];
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 1_000_000) { tooLarge = true; req.destroy(); }
    });
    req.on('end', async () => {
      if (tooLarge) { res.writeHead(413).end(); return; }
      res.setHeader('Content-Type', 'application/json');
      let method, params;
      try {
        ({ method, params } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        if (typeof method !== 'string') throw new Error('BAD_REQUEST: "method" must be a string.');
      } catch (error) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
        return;
      }
      try {
        const result = await callRenderer(method, params ?? {}, 8000);
        res.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
      }
    });
  });

  // Push channel (mcp-server/index.mjs's board_probe_guide_watch_url): a probe guide step change is pushed to every
  // connected client the moment the renderer reports it, instead of a client having to poll probeGuideStatus. Same
  // server/port as the RPC endpoint, one fixed path; the token travels as a query param because a WebSocket upgrade
  // request cannot carry a bearer header the way the RPC POST does.
  const wss = new WebSocketServer({ server, path: '/probe-guide-events' });
  wss.on('connection', (ws, req) => {
    let suppliedToken;
    try { suppliedToken = new URL(req.url, 'http://127.0.0.1').searchParams.get('token'); } catch { suppliedToken = null; }
    if (suppliedToken !== token) { ws.close(1008, 'unauthorized'); return; }
    if (lastProbeGuideStatus) ws.send(JSON.stringify(lastProbeGuideStatus));
  });

  function notifyProbeGuideChanged(status) {
    lastProbeGuideStatus = status;
    const payload = JSON.stringify(status);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    fs.writeFileSync(controlFilePath, JSON.stringify({ port, token, pid: process.pid }));
    log?.(`[mcp-bridge] listening on 127.0.0.1:${port} (control file: ${controlFilePath})`);
  });
  server.on('error', (error) => log?.(`[mcp-bridge] server error: ${error.message}`));

  function stop() {
    try { fs.unlinkSync(controlFilePath); } catch { /* already gone */ }
    wss.close();
    server.close();
  }

  return { handleResponse, notifyProbeGuideChanged, stop };
}

module.exports = { startMcpBridge, defaultControlFilePath: path.join(__dirname, '..', '.mcp-bridge.json') };
