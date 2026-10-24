import type { Bounds2, Point2 } from '../lib/geometry';
import type { ProbeColor, ProbeGuideState } from '../lib/probe-guide';
import { resolveProbeMarkers } from '../lib/probe-guide';
import type { Frame2D, Layer2D } from './board-render-2d';

/**
 * Feature layers for the Probe Guide (Package D): the coloured pin markers of the active step, and a small always-on minimap so a
 * zoomed-in user does not lose board context. Both read only the current step's resolved markers (closed over once per build, not
 * recomputed per frame) and the generic `Frame2D` a feature layer gets from the renderer (board-render-2d.ts).
 */

/** High-contrast, colour-blind-friendlier than the raw board palette: a marker must read on both board themes at a glance. */
const MARKER_COLORS: Record<ProbeColor, string> = { red: '#ff3b30', blue: '#2f7bff' };

/** Screen-space marker radius (CSS px) before it is converted to board mm for the current zoom, following `drawSelectionMarkers`'s convention. */
const MARKER_SCREEN_RADIUS_PX = 6;

type ResolvedMarker = { color: ProbeColor; point: Point2; label?: string };
/** Minimal projection of `board-index.ts`'s `BoardIndex` that `resolveProbeMarkers` needs (Package A's contract). */
export interface ProbeGuideLookup { pin(id: string): Point2 | undefined; component(id: string): { bounds: Bounds2 } | undefined }

function drawMarker(f: Frame2D, marker: ResolvedMarker): void {
  const { ctx, view } = f;
  const dark = f.state.theme === 'dark';
  f.toBoardSpace();
  const radius = MARKER_SCREEN_RADIUS_PX / view.scale;
  const color = MARKER_COLORS[marker.color];
  // Outer glow (a static stand-in for a pulse: cheap, legible, no per-frame animation plumbing needed outside board-render-2d.ts).
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.arc(marker.point.x, marker.point.y, radius * 1.9, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.restore();
  // The filled dot with a theme-appropriate outline, so it reads over both light and dark board fills.
  ctx.beginPath(); ctx.arc(marker.point.x, marker.point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 2 / view.scale;
  ctx.strokeStyle = dark ? '#0b1118' : '#ffffff';
  ctx.stroke();
}

function drawMarkerLabel(f: Frame2D, marker: ResolvedMarker): void {
  if (!marker.label) return;
  const { ctx, palette } = f;
  f.toScreenSpace();
  const screen = f.boardToScreen(marker.point);
  const text = marker.label;
  ctx.font = "600 11px 'IBM Plex Mono', Consolas, monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text).width;
  const x = screen.x + 11, y = screen.y - 12;
  ctx.fillStyle = palette.card;
  ctx.strokeStyle = MARKER_COLORS[marker.color];
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x - 5, y - 11, textWidth + 10, 22, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = palette.text;
  ctx.fillText(text, x, y);
}

function markerLayer(markers: readonly ResolvedMarker[]): Layer2D {
  return {
    id: 'probe-markers',
    surface: 'overlay',
    order: 400,
    draw(f: Frame2D) {
      for (const marker of markers) drawMarker(f, marker);
      for (const marker of markers) drawMarkerLabel(f, marker);
    },
  };
}

/** Inset size and margin (CSS px) of the minimap, bottom-right corner, above the compass (LAYER_ORDER.compass = 900). */
const MINIMAP_WIDTH = 140, MINIMAP_HEIGHT = 100, MINIMAP_MARGIN = 14, MINIMAP_PAD = 9;

function minimapLayer(markers: readonly ResolvedMarker[]): Layer2D {
  return {
    id: 'probe-minimap',
    surface: 'overlay',
    order: 950,
    draw(f: Frame2D) {
      const { ctx, palette, width, height } = f;
      f.toScreenSpace();
      const x0 = width - MINIMAP_WIDTH - MINIMAP_MARGIN, y0 = height - MINIMAP_HEIGHT - MINIMAP_MARGIN;
      ctx.save();
      // Panel background/border, legible on both themes (the app's own card/board-line colours, not hardcoded); a plain canvas
      // alpha composite (not a CSS color-mix() string) keeps this portable across Canvas2D implementations.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = palette.card;
      ctx.strokeStyle = palette.boardLine;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x0, y0, MINIMAP_WIDTH, MINIMAP_HEIGHT, 8); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      // Board bounds (board.bounds, already carried by the scene — never recomputed here) mapped into the inset, Y flipped
      // (canonical board space is Y-up; screen space is Y-down, as board-view.ts's boardToScreen already does for the main view).
      const b = f.scene.board.bounds;
      const boardW = Math.max(1e-6, b.maxX - b.minX), boardH = Math.max(1e-6, b.maxY - b.minY);
      const availW = MINIMAP_WIDTH - MINIMAP_PAD * 2, availH = MINIMAP_HEIGHT - MINIMAP_PAD * 2;
      const mapScale = Math.min(availW / boardW, availH / boardH);
      const originX = x0 + MINIMAP_PAD + (availW - boardW * mapScale) / 2;
      const originY = y0 + MINIMAP_PAD + (availH - boardH * mapScale) / 2;
      const toInset = (p: Point2): Point2 => ({ x: originX + (p.x - b.minX) * mapScale, y: originY + (b.maxY - p.y) * mapScale });

      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(originX, originY, boardW * mapScale, boardH * mapScale);

      // The viewport rectangle of this pane, within the same inset space.
      const vp = f.viewport();
      const corner1 = toInset({ x: vp.minX, y: vp.maxY });
      const corner2 = toInset({ x: vp.maxX, y: vp.minY });
      ctx.strokeStyle = palette.amber;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(Math.min(corner1.x, corner2.x), Math.min(corner1.y, corner2.y), Math.abs(corner2.x - corner1.x), Math.abs(corner2.y - corner1.y));

      for (const marker of markers) {
        const p = toInset(marker.point);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = MARKER_COLORS[marker.color];
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

/**
 * The Probe Guide's feature layers for the active step: the pin markers (order 400, above selection/measurement) and a small
 * always-on minimap (order 950, above the compass). Returns `[]` when no guide is active or the current step resolves no markers.
 */
export function buildProbeGuideLayers(probeGuide: ProbeGuideState | null, lookup: ProbeGuideLookup): Layer2D[] {
  if (!probeGuide) return [];
  const step = probeGuide.guide.steps[probeGuide.currentStepId];
  if (!step) return [];
  const markers = resolveProbeMarkers(step, lookup);
  if (!markers.length) return [];
  return [markerLayer(markers), minimapLayer(markers)];
}
