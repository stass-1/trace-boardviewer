---
title: "Probe guide waiting: client-side short-poll-with-reconnect, not a server-held long-poll"
author: Stanislau
date: 2026-10-24
branch: main
cost: { minutes: 77, tokens: 559009 }
id: l-36772602
scope: repo
status: active
src: agent
touches:
  - electron/locales/de/probe.json
  - electron/locales/en/probe.json
  - electron/locales/fr/probe.json
  - electron/locales/hu/probe.json
  - electron/locales/it/probe.json
  - electron/locales/pl/probe.json
  - electron/locales/sk/probe.json
  - electron/locales/uk/probe.json
  - mcp-server/index.mjs
  - src/app/api.ts
---

## Decided
Added `board_probe_guide_await_choice` to mcp-server/index.mjs: it polls the existing,
unchanged `probeGuideStatus` RPC every ~1s in a loop and returns as soon as
currentStepId/history changes (or the guide ends), instead of the agent polling
board_probe_guide_status itself in a chat loop. Zero changes to electron/mcp-bridge.cjs,
preload.cjs, useWorkspace.ts or mcp-dispatch.ts.

## Tried and ruled out
Considered a true server-held long-poll: a new renderer action that returns a Promise
resolved only when advanceProbeGuide() next fires, with useWorkspace.ts's onMcpRequest
handler awaiting it before calling sendMcpResponse, and mcp-bridge.cjs's hardcoded 8000ms
callRenderer timeout raised for this one method. Ruled out: holding one HTTP request open
for minutes has no heartbeat, so a silent failure (Vite HMR reloading the renderer mid-wait,
which was already observed resetting probeGuide state) leaves the request hung with nothing
noticing. A chain of short independent polls detects that within ~1-2s instead and just
retries, which is simpler and needed no plumbing changes.

## Watch out
Default maxWaitMs is 10 minutes (matches this harness's other tool timeout conventions,
e.g. the Bash tool's 600000ms foreground cap) — on timedOut:true the caller must call the
tool again to keep waiting, it is not an error.
