import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import './workspace.css';

export const RATIO_MIN = 0.2, RATIO_MAX = 0.8, RATIO_DEFAULT = 0.5;
export const clampRatio = (value: number) => Number.isFinite(value) ? Math.min(RATIO_MAX, Math.max(RATIO_MIN, value)) : RATIO_DEFAULT;
const STEP = 0.02, BIG_STEP = 0.1;

export interface SplitLayoutProps {
  ratio: number; onRatio(ratio: number): void; left: ReactNode; right: ReactNode;
  /** Already-localized strings (the caller owns `t()`, so this component stays usable for any pair of panes, not just board/document). */
  leftLabel: string; rightLabel: string; dividerLabel: string; dividerHint: string;
  /** Formats the divider's live `aria-valuetext` from the left pane's current share (0-100), e.g. "42% board". */
  dividerValueText(percent: number): string;
}

/**
 * Two panes with an adjustable divider. Dragging previews locally and persists once at the end; the keyboard
 * (arrows, Shift = big step, Home/End, Enter or double-click = reset) persists every step. The ratio is always clamped to 0.2..0.8.
 */
export function SplitLayout({ ratio, onRatio, left, right, leftLabel, rightLabel, dividerLabel, dividerHint, dividerValueText }: SplitLayoutProps) {
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dragging = useRef(false);
  const shown = clampRatio(drag ?? ratio);
  useEffect(() => { if (!dragging.current) setDrag(null); }, [ratio]);
  const ratioAt = useCallback((clientX: number) => {
    const rect = root.current!.getBoundingClientRect();
    return clampRatio((clientX - rect.left) / Math.max(1, rect.width));
  }, []);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; setDrag(ratioAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (dragging.current) setDrag(ratioAt(event.clientX)); };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false; const next = ratioAt(event.clientX); setDrag(next); onRatio(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = shown - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = shown + step;
    else if (event.key === 'Home') next = RATIO_MIN;
    else if (event.key === 'End') next = RATIO_MAX;
    else if (event.key === 'Enter') next = RATIO_DEFAULT;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation(); onRatio(clampRatio(next));
  };
  return <div ref={root} className="wsp-split" data-testid="split-layout" data-dragging={drag !== null && dragging.current} style={{ gridTemplateColumns: `minmax(0, ${shown}fr) 10px minmax(0, ${1 - shown}fr)` }}>
    <div className="wsp-pane" aria-label={leftLabel} data-testid="split-left">{left}</div>
    <div className="wsp-divider" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={dividerLabel} title={dividerHint} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(shown * 100)} aria-valuetext={dividerValueText(Math.round(shown * 100))} data-testid="split-divider"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish} onKeyDown={onKeyDown} onDoubleClick={() => onRatio(RATIO_DEFAULT)}><span className="wsp-grip" aria-hidden="true" /></div>
    <div className="wsp-pane" aria-label={rightLabel} data-testid="split-right">{right}</div>
  </div>;
}
