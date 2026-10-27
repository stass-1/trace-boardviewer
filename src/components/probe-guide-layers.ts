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
const MARKER_SCREEN_RADIUS_PX = 5.5;

type ResolvedMarker = { color: ProbeColor; point: Point2; label?: string };
/** Minimal projection of `board-index.ts`'s `BoardIndex` that `resolveProbeMarkers` needs (Package A's contract). */
export interface ProbeGuideLookup { pin(id: string): Point2 | undefined; component(id: string): { bounds: Bounds2 } | undefined }

function drawPairLink(f: Frame2D, markers: readonly ResolvedMarker[]): void {
  if (markers.length !== 2) return;
  const { ctx } = f;
  f.toScreenSpace();
  const a = f.boardToScreen(markers[0].point);
  const b = f.boardToScreen(markers[1].point);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 18) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = f.palette.amber;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.restore();
}

function drawMarker(f: Frame2D, marker: ResolvedMarker): void {
  const { ctx, view } = f;
  const dark = f.state.theme === 'dark';
  f.toBoardSpace();
  const radius = MARKER_SCREEN_RADIUS_PX / view.scale;
  const ringRadius = (MARKER_SCREEN_RADIUS_PX * 2.25) / view.scale;
  const tickInner = (MARKER_SCREEN_RADIUS_PX * 1.8) / view.scale;
  const tickOuter = (MARKER_SCREEN_RADIUS_PX * 2.85) / view.scale;
  const color = MARKER_COLORS[marker.color];
  const { x, y } = marker.point;

  // Soft outer halo + precision target reticle ring so the pad underneath remains legible while the target catches the eye immediately.
  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.beginPath(); ctx.arc(x, y, radius * 2.0, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();

  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / view.scale;
  ctx.stroke();

  // Four crosshair ticks (N, S, E, W) around the target ring.
  ctx.beginPath();
  ctx.moveTo(x - tickOuter, y); ctx.lineTo(x - tickInner, y);
  ctx.moveTo(x + tickInner, y); ctx.lineTo(x + tickOuter, y);
  ctx.moveTo(x, y - tickOuter); ctx.lineTo(x, y - tickInner);
  ctx.moveTo(x, y + tickInner); ctx.lineTo(x, y + tickOuter);
  ctx.lineWidth = 1.6 / view.scale;
  ctx.stroke();
  ctx.restore();

  // The filled center dot with a theme-appropriate outline, so it reads over both light and dark board fills.
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 2 / view.scale;
  ctx.strokeStyle = dark ? '#0b1118' : '#ffffff';
  ctx.stroke();
}

function drawMarkerLabel(f: Frame2D, marker: ResolvedMarker, verticalOffsetPx: number): void {
  if (!marker.label) return;
  const { ctx, palette } = f;
  f.toScreenSpace();
  const screen = f.boardToScreen(marker.point);
  const text = marker.label;
  const color = MARKER_COLORS[marker.color];
  const sign = marker.color === 'red' ? '+' : '−';

  ctx.save();
  ctx.font = "600 11px 'IBM Plex Mono', Consolas, monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text).width;
  const badgeW = textWidth + 30;
  const badgeH = 24;
  const boxX = screen.x + 14;
  const boxY = screen.y + verticalOffsetPx - badgeH / 2;

  ctx.fillStyle = palette.card;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(boxX, boxY, badgeW, badgeH, 7); ctx.fill(); ctx.stroke();

  // Polarity dot (+ / −) inside the left side of the pill for instant color-blind-safe identification.
  const dotX = boxX + 11, dotY = boxY + badgeH / 2;
  ctx.beginPath(); ctx.arc(dotX, dotY, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = "700 11px 'IBM Plex Mono', Consolas, monospace";
  ctx.textAlign = 'center';
  ctx.fillText(sign, dotX, dotY + 0.5);

  ctx.fillStyle = palette.text;
  ctx.font = "600 11px 'IBM Plex Mono', Consolas, monospace";
  ctx.textAlign = 'left';
  ctx.fillText(text, boxX + 22, dotY);
  ctx.restore();
}

function markerLayer(markers: readonly ResolvedMarker[]): Layer2D {
  return {
    id: 'probe-markers',
    surface: 'overlay',
    order: 400,
    draw(f: Frame2D) {
      drawPairLink(f, markers);
      for (const marker of markers) drawMarker(f, marker);
      // Avoid label overlap when two markers sit close together in screen space.
      let spreadClosePair = false;
      if (markers.length === 2) {
        const s0 = f.boardToScreen(markers[0].point);
        const s1 = f.boardToScreen(markers[1].point);
        spreadClosePair = Math.abs(s0.y - s1.y) < 30 && Math.abs(s0.x - s1.x) < 160;
      }
      markers.forEach((marker, idx) => {
        const offsetY = spreadClosePair ? (idx === 0 ? -16 : 16) : -14;
        drawMarkerLabel(f, marker, offsetY);
      });
    },
  };
}

/**
 * Inset size and margin (CSS px) of the minimap, bottom-right corner, above the compass (LAYER_ORDER.compass = 900).
 * `MINIMAP_BOTTOM_MARGIN` clears the `.canvas-bottom` toolbar (BoardPane.tsx: `bottom:20px` + ~40px of zoom/tool buttons, see
 * workspace.css `.tool-group`), which otherwise sits under the minimap's lower half.
 */
const MINIMAP_WIDTH = 140, MINIMAP_HEIGHT = 100, MINIMAP_SIDE_MARGIN = 14, MINIMAP_BOTTOM_MARGIN = 94, MINIMAP_PAD = 9;

function minimapLayer(markers: readonly ResolvedMarker[]): Layer2D {
  return {
    id: 'probe-minimap',
    surface: 'overlay',
    order: 950,
    draw(f: Frame2D) {
      const { ctx, palette, width, height } = f;
      const dark = f.state.theme === 'dark';
      f.toScreenSpace();
      const x0 = width - MINIMAP_WIDTH - MINIMAP_SIDE_MARGIN, y0 = height - MINIMAP_HEIGHT - MINIMAP_BOTTOM_MARGIN;
      ctx.save();
      // Panel background/border, legible on both themes (the app's own card/board-line colours, not hardcoded); a plain canvas
      // alpha composite (not a CSS color-mix() string) keeps this portable across Canvas2D implementations.
      ctx.globalAlpha = 0.92;
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

      if (markers.length === 2) {
        const p0 = toInset(markers[0].point);
        const p1 = toInset(markers[1].point);
        ctx.save();
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = palette.amber;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.restore();
      }

      for (const marker of markers) {
        const p = toInset(marker.point);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = MARKER_COLORS[marker.color];
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = dark ? '#0b1118' : '#ffffff';
        ctx.stroke();
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
