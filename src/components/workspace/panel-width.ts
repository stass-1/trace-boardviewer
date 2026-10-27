import { useCallback, useState } from 'react';

/** Shared bounds for both side panels: narrow enough to still show a ref+value row, wide enough to never crowd out the board. */
export const PANEL_WIDTH_MIN = 180;
export const PANEL_WIDTH_MAX = 480;
export const LEFT_PANEL_DEFAULT_WIDTH = 246;
export const RIGHT_PANEL_DEFAULT_WIDTH = 294;

export const clampPanelWidth = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, value)) : fallback;

const STORAGE_KEY = 'trace-panel-widths';
interface StoredWidths { left?: number; right?: number }

/**
 * Sidebar widths are a renderer-only, cosmetic preference (unlike `AppSettings` in settings.ts, which is validated by the main
 * process and synced to the portable profile): localStorage is enough, and it already survives an app restart in the desktop
 * build since the renderer keeps the same origin/profile across launches.
 */
function readStored(): StoredWidths {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return raw && typeof raw === 'object' ? raw as StoredWidths : {};
  } catch { return {}; }
}
function writeStored(next: StoredWidths): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private window or storage disabled: resizing still works this session */ }
}

/** The two side panels' widths (CSS px), lazily read once and persisted on every drag-release/keyboard step. */
export function usePanelWidths(): { left: number; right: number; setLeft(width: number): void; setRight(width: number): void } {
  const [widths, setWidths] = useState(() => {
    const stored = readStored();
    return {
      left: clampPanelWidth(stored.left ?? LEFT_PANEL_DEFAULT_WIDTH, LEFT_PANEL_DEFAULT_WIDTH),
      right: clampPanelWidth(stored.right ?? RIGHT_PANEL_DEFAULT_WIDTH, RIGHT_PANEL_DEFAULT_WIDTH),
    };
  });
  const setLeft = useCallback((width: number) => setWidths(current => {
    const next = { ...current, left: clampPanelWidth(width, LEFT_PANEL_DEFAULT_WIDTH) };
    writeStored(next); return next;
  }), []);
  const setRight = useCallback((width: number) => setWidths(current => {
    const next = { ...current, right: clampPanelWidth(width, RIGHT_PANEL_DEFAULT_WIDTH) };
    writeStored(next); return next;
  }), []);
  return { left: widths.left, right: widths.right, setLeft, setRight };
}
