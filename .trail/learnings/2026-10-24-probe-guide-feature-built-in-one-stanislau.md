---
title: "Probe Guide feature: built in one pass via parallel subagents, using existing canvas extension points"
author: Stanislau
date: 2026-10-24
branch: main
cost: { minutes: 56, tokens: 283519 }
id: l-70c6b2f9
scope: repo
status: active
src: agent
touches:
  - "проекты/gt72/CLAUDE.md"
  - "проекты/gt72/FINDINGS.md"
  - "проекты/gt72/PLAN.md"
  - "проекты/gt72/PROJECT.md"
  - "проекты/gt72/TOOLS.md"
  - src/components/workspace/ProbeGuideHud.tsx
  - electron/locales/en/board.json
  - electron/locales/hu/board.json
  - electron/locales/de/board.json
  - electron/locales/fr/board.json
---

## Decided
- Built the whole "Probe Guide" feature (JSON branching multimeter-measurement steps, colored
  probe markers, HUD, keyboard nav, split-screen, minimap) in one pass instead of staging it
  MVP-first. User explicitly chose "всё сразу" over a staged MVP-then-polish option when asked.
- Orchestrated the build as 4 parallel subagents against a contract frozen up front in the plan
  file, each owning disjoint files: A) src/lib/probe-guide.ts + api.ts/controller.ts/mock-api.ts
  (state), B) mcp-server/index.mjs + mcp-dispatch.ts (MCP tools), C) src/lib/types.ts +
  BoardCanvas.tsx (generic `fit-bounds` ViewCommand + `splitView` prop), D) everything
  probe-guide-domain-specific (new probe-guide-layers.ts, ProbeGuideHud.tsx, BoardPane.tsx,
  shortcuts.ts, Shell.tsx, workspace.css). No file overlap between packages, so no worktree
  isolation was needed — straight parallel Agent calls in the same working tree.
- Discovered mid-plan (after dispatching Explore agents) that BoardCanvas.tsx already exposes
  `layers?: Layer2D[]` (merged into the renderer via `setLayers`/`restack()`) and an animated
  `moveView`-backed `viewCommand` mechanism (`'center-selection'` case at BoardCanvas.tsx
  ~L372-379, 190ms cubic-ease-out tween). This meant new probe-marker/minimap rendering and
  "smooth zoom to a point" did NOT need any change to board-render-2d.ts's built-in layer stack
  or a new animation system — just a new external Layer2D array and one new `'fit-bounds'`
  ViewCommand case mirroring `'center-selection'` but taking arbitrary `bounds` instead of a
  selected component. Kept BoardCanvas.tsx's new `splitView`/`fit-bounds` additions
  domain-agnostic (no "probe" wording) so they're reusable by any future feature.

## Tried and ruled out
- Package C's split-view panes: live pan/zoom gestures *within* a split pane were explicitly
  skipped for v1 (panes are fit-and-fixed, recomputed only when the bounds prop changes) —
  wiring per-pane gestures into the existing single `viewRef`-based onWheel/onPointerMove
  machinery would have meant touching many call sites for a feature with no immediate need.
  Documented with a code comment at `splitViewRef`'s declaration in BoardCanvas.tsx.

## Watch out
- This repo's i18n tooling enforces, via tests (src/lib/i18n.test.ts "catalog completeness" /
  placeholder parity / `src/lib/i18n-lint.test.ts` literal-English gate / a11y-labels.test.ts /
  `src/lib/i18n-script.test.ts` "uses a namespace named like the area"), that: (1) no raw
  English/other-language string literals or literal `aria-label`s may appear in src/components
  JSX — everything routes through `useUi().t('key')`; (2) EVERY one of the 8 locale catalogs
  (en, hu, de, fr, it, pl, sk, uk — no Russian) must have the exact same key set, not just
  en+hu; (3) a brand-new key-prefix "area" (e.g. `probe.*`) is expected to live in its OWN
  dedicated `<area>.json` namespace file per locale, not be appended into an unrelated existing
  namespace like board.json — `i18n-script.test.ts`'s "adding a key" test literally asserts
  this by pre-seeding an empty namespace file named after the area and checking `addKey` prefers
  it. Also: `src/lib/i18n-english.ts` statically imports+merges every `electron/locales/en/*.json`
  file by name (this is what gives `MessageKey` its literal-union type via `keyof typeof en`) —
  adding a new namespace file requires adding one import line + one line in the merge spread
  there, or `tsc` fails with "type not assignable" on every new key use; the other 7 languages
  are picked up automatically via `import.meta.glob` in src/lib/i18n.ts, no registration needed.
  A subagent that doesn't know this will hardcode UI strings "for v1" and break `pnpm test`.
