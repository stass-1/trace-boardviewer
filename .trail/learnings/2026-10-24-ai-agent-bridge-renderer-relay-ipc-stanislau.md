---
title: "AI agent bridge: renderer-relay IPC chosen over Playwright/CDP"
author: Stanislau
date: 2026-10-24
branch: main
cost: { minutes: 14, tokens: 191131 }
id: l-9172c1c9
scope: repo
status: active
src: agent
touches:
  - electron/mcp-bridge.cjs
  - electron/main.cjs
  - electron/preload.cjs
  - src/app/mcp-dispatch.ts
  - src/lib/types.ts
  - src/app/useWorkspace.ts
  - mcp-server/package.json
  - mcp-server/index.mjs
  - scripts/qa-workspace-e2e.cjs
  - scripts/packaged-functional-qa.cjs
---

## Decided
Added an opt-in local control channel so an MCP server (mcp-server/) can query the board
currently open in the app and tell the running window to select/highlight a component,
pin, or net - so a human watching the app sees what the agent is discussing.

Architecture: electron/mcp-bridge.cjs runs a loopback-only HTTP server (127.0.0.1, random
port, bearer token) in the main process, gated behind TRACE_MCP_BRIDGE=1 (off by default -
an ordinary launch never opens a network listener). It writes {port, token} to
.mcp-bridge.json at the repo root (gitignored). Each HTTP /rpc call is relayed to the
renderer over a new IPC channel (trace:mcp-request / trace:mcp-response, wired in
electron/preload.cjs as traceDesktop.onMcpRequest/sendMcpResponse) and answered by
src/app/mcp-dispatch.ts::handleMcpRequest, which reads controller.getSnapshot() and calls
controller.actions (selectComponent/selectPin/selectNet/clearSelection) - wired into
src/app/useWorkspace.ts's existing per-controller useEffect.

## Tried and ruled out
Driving the UI externally via Playwright's `_electron` (the same mechanism
scripts/qa-workspace-e2e.cjs and scripts/packaged-functional-qa.cjs already use for CDP
automation) was considered, since it needs zero app code changes. Ruled out because it
would launch a second, separate app instance rather than control the one the user already
has open and is looking at, and it's fragile (depends on data-testid selectors instead of
the Controller's own typed actions).

## Watch out
- The bridge only exists in this fork; nothing upstream. Board data (Board/BoardIndex)
  lives only in the renderer's Controller - the main process never parses GenCAD itself,
  so queries always reflect whatever is actually loaded in the window (requires a board to
  be open; fails with NO_BOARD otherwise).
- Single mainWindow model (electron/main.cjs): the bridge always targets `mainWindow`, not
  per-window. Fine for this app (one window), would need revisiting if that ever changes.
- mcp-server/ is a separate npm package (own node_modules, zod v4 + @modelcontextprotocol/sdk
  ^1.12) rather than a repo dependency, specifically to avoid pulling MCP-SDK/zod into the
  Electron app's own bundle.
- Registered for Claude Code via `claude mcp add trace-board -s project` -> repo-root
  .mcp.json, pointing at the manually-placed Node 24.22.1 binary (see earlier learning on
  nvm-windows being non-functional in the sandboxed shell) - command path is
  machine-specific, expected for a personal fork.
