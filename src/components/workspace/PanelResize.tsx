import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from './panel-width';

export interface PanelResizeHandleProps {
  /** Which side of the main content this panel sits on: dragging right grows a 'left' panel but shrinks a 'right' one. */
  side: 'left' | 'right';
  width: number;
  onResize(width: number): void;
  label: string;
}

const STEP = 12, BIG_STEP = 48;

/** A thin draggable gutter that resizes an adjacent side panel, styled like SplitLayout.tsx's `.wsp-divider`/`.wsp-grip`. */
export function PanelResizeHandle({ side, width, onResize, label }: PanelResizeHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = event.clientX - start.current.x;
    onResize(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, start.current.width + (side === 'left' ? delta : -delta))));
  };
  const finish = () => { start.current = null; setDragging(false); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const grow = side === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
    const shrink = side === 'left' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
    if (!grow && !shrink) return;
    event.preventDefault();
    onResize(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width + (grow ? step : -step))));
  };
  return <div className="wsp-panel-resize" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={label}
    aria-valuemin={PANEL_WIDTH_MIN} aria-valuemax={PANEL_WIDTH_MAX} aria-valuenow={Math.round(width)} data-dragging={dragging} data-testid={`panel-resize-${side}`}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish} onKeyDown={onKeyDown}>
    <span className="wsp-grip" aria-hidden="true" />
  </div>;
}
