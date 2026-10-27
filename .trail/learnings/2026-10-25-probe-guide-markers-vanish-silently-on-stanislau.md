---
title: Probe guide markers vanish silently on a wrong/guessed pinId; loadProbeGuide now warns
author: Stanislau
date: 2026-10-25
branch: main
cost: { minutes: 129, tokens: 596093 }
id: l-7d51d945
scope: repo
status: active
src: agent
touches:
  - mcp-server/index.mjs
  - electron/mcp-bridge.cjs
  - electron/main.cjs
  - electron/preload.cjs
  - src/lib/types.ts
  - src/app/mcp-dispatch.ts
  - src/app/useWorkspace.ts
  - src/app/controller.ts
  - src/lib/probe-guide.ts
  - src/app/api.ts
---

## Decided
Added marker validation to the `loadProbeGuide` MCP dispatch case (src/app/mcp-dispatch.ts):
a new `validateProbeGuideMarkers(guide, boardIndex)` checks every step's probes against
`boardIndex.pinById`/`componentById` right after `actions.loadProbeGuide(guide)`, and
`board_probe_guide_load`'s tool result (mcp-server/index.mjs) now appends a WARNING block
listing any marker whose pinId/componentId wasn't found on the board, instead of staying
silent. This closes a feedback gap for whoever (AI or human) calls the MCP tool: previously
the only signal was the human reporting "I don't see highlighted contacts" after actually
looking at the app.

## Tried and ruled out
Did not change `resolveProbeMarkers` in src/lib/probe-guide.ts (the pure function the canvas
layer calls every frame) to warn/throw — it is correct for it to keep silently skipping an
unresolved marker (so one bad marker in a 2-probe step doesn't crash rendering of the other);
the validation belongs at load time, once, on the MCP/dispatch boundary where the caller can
actually act on it.

## Watch out
- Root cause of the actual incident: authored a probe guide with `pinId: "R445.1"` /
  `"R445.2"` (a guessed dot-separated format) instead of querying `board_get_component` first.
  Real pin ids on this board are parser-assigned, e.g. `"R445:1:0"`, `"R445:2:1"` — colon-joined
  `ref:number:index`, not dot-joined, and **not a format to memorize or reuse across
  components**: `BoardPin.id` is documented in src/lib/types.ts as "Session-local handle
  (numbered by the parser); never persist it." ALWAYS call `board_get_component` (or
  `board_get_net`) immediately before authoring/reusing a pinId in a probe guide, even for a
  component already probed earlier in the same session — never type a pinId from memory.
- The failure mode when a pinId is wrong is totally silent on screen: `resolveProbeMarkers`
  (src/lib/probe-guide.ts) just drops markers it can't resolve, so the HUD instruction text
  still renders fine, only the colored dots on the canvas are missing. If the user reports
  "I don't see the highlighted pins" after a `board_probe_guide_load` call, check the tool's
  own response text first for the new WARNING block before assuming a rendering/HMR issue.
