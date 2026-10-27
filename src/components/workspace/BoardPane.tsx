import { Layers2, Minus, Plus, RotateCw, Route, Ruler, Scan, StickyNote, Tags, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { WorkspaceApi } from '../../app/api';
import type { SearchRow } from '../../lib/crossprobe';
import type { Bounds2, Point2 } from '../../lib/geometry';
import { boundsFromPoints, expandBounds } from '../../lib/geometry';
import type { ProbeMarker } from '../../lib/probe-guide';
import { resolveProbeMarkers } from '../../lib/probe-guide';
import type { AppSettings, ViewCommand, ViewSide } from '../../lib/types';
import BoardCanvas from '../BoardCanvas';
import type { BoardCamera } from '../board-camera';
import { buildProbeGuideLayers } from '../probe-guide-layers';
import type { ProbeGuideLookup } from '../probe-guide-layers';
import { indexOfState } from './model';
import { FocusSearch } from './SearchPanel';
import { RATIO_DEFAULT, SplitLayout } from './SplitLayout';
import { LiveMeasurement, LiveRotation, LiveZoom } from './StatusBar';
import { Tool } from './ui';
import { useUi } from './ui-context';
import './workspace.css';

export interface BoardPaneProps {
  api: WorkspaceApi;
  side: ViewSide; onSide(side: ViewSide): void;
  netVisible: boolean; onNetVisible(next: boolean): void;
  measure: boolean; onMeasure(next: boolean): void;
  viewCommand: (ViewCommand & { automatic?: boolean }) | null; command(type: ViewCommand['type'], bounds?: Bounds2): void;
  /** Stored view of this board, restored instead of the automatic fit; `onCameraChange` persists user changes (idle-debounced by the canvas). */
  initialCamera: BoardCamera | null; onCameraRestore(camera: BoardCamera): void; onCameraChange(camera: BoardCamera): void;
  settings: AppSettings; onSettings(next: Partial<AppSettings>): void;
  theme: 'dark' | 'light';
  focusLayout: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  recentSelections: string[];
  hasNote: boolean;
  onEditNote(): void;
  onSelectComponent(id: string | null): void;
  onSelectPin(id: string): void;
  onLocate(id: string): void;
  onSearchActivated(row: SearchRow): void;
}

/** Markers spread over more than this fraction of the board's diagonal get a split view (each probe point gets its own fitted pane) instead of one shared camera fit; below it, a single `fit-bounds` command keeps both points comfortably on screen together. Chosen so two probes a connector's width apart share a pane, while two probes on opposite corners of the board each get their own close-up. */
const PROBE_SPLIT_DIAGONAL_FRACTION = 0.35;
/** Padding (board mm) around probe points when framing them, whether via `fit-bounds` or a split pane's own bounds. */
const PROBE_FRAME_PADDING_MM = 6;

/** The board canvas with its overlays. Pointer-rate values (zoom, rotation, measurement) come from the status store, so this pane never re-renders for them. */
export function BoardPane(props: BoardPaneProps) {
  const { api, side, onSide, netVisible, onNetVisible, measure, onMeasure, viewCommand, command, initialCamera, onCameraRestore, onCameraChange, settings, onSettings, theme, focusLayout, searchRef, recentSelections, hasNote, onEditNote, onSelectComponent, onSelectPin, onLocate, onSearchActivated } = props;
  const { t, fmt, language } = useUi();
  const { state, statusStore } = api;
  const board = state.board!;
  const index = indexOfState(state)!;
  const { selection, probeGuide } = state;

  // Package A's resolveProbeMarkers contract: a lookup of pin position / component bounds, built from the already-shared BoardIndex.
  const lookup: ProbeGuideLookup = useMemo(() => ({
    pin: (id: string): Point2 | undefined => index.pinById.get(id),
    component: (id: string) => index.componentById.get(id),
  }), [index]);
  const probeLayers = useMemo(() => buildProbeGuideLayers(probeGuide, lookup), [probeGuide, lookup]);

  const currentProbeStep = probeGuide ? probeGuide.guide.steps[probeGuide.currentStepId] : null;
  const probeMarkers = useMemo(() => (currentProbeStep ? resolveProbeMarkers(currentProbeStep, lookup) : []), [currentProbeStep, lookup]);
  // A marker's dot is drawn at the right board-space point regardless of which side is on screen, but if the canvas is showing the
  // *other* physical side, there is no matching pad under it there — same XY, a different (or no) component — which reads as "the
  // dot isn't on the contact" even though the coordinate is exact. Resolve each probe's own side (pin wins over component; 'both'
  // defers to whatever is already shown) so each pane — or the single non-split camera — can be forced onto the side that actually
  // has that pad, the same way `deriveSide` (model.ts) already does for an ordinary selection.
  const sideOfProbe = (probe: ProbeMarker | undefined): ViewSide | null => {
    if (!probe) return null;
    const pinSide = probe.pinId ? index.pinById.get(probe.pinId)?.side : undefined;
    const componentSide = pinSide ?? index.componentById.get(probe.componentId)?.side;
    return componentSide && componentSide !== 'both' ? componentSide : null;
  };
  // Two probe points far enough apart get a split view (each its own fitted pane); any other marker count (0, 1, or >2) has no
  // well-defined left/right split, so it always falls back to the single-camera fit-bounds effect below. A single shared camera
  // can only show one physical side at a time, so two probes that live on *opposite* sides always need a split view too, no
  // matter how close their XY coordinates are — otherwise one marker reads as sitting on the wrong pad (same bug the side-fix
  // above solves for the non-split camera, but there is no single `side` that is correct for both probes at once here).
  const splitView = useMemo(() => {
    if (probeMarkers.length !== 2) return null;
    const side0 = sideOfProbe(currentProbeStep?.probes[0]);
    const side1 = sideOfProbe(currentProbeStep?.probes[1]);
    const oppositeSides = !!side0 && !!side1 && side0 !== side1;
    if (!oppositeSides) {
      const boardDiagonal = Math.hypot(board.bounds.maxX - board.bounds.minX, board.bounds.maxY - board.bounds.minY);
      const markerDiagonal = Math.hypot(probeMarkers[1].point.x - probeMarkers[0].point.x, probeMarkers[1].point.y - probeMarkers[0].point.y);
      if (boardDiagonal <= 0 || markerDiagonal / boardDiagonal <= PROBE_SPLIT_DIAGONAL_FRACTION) return null;
    }
    const pointBounds = (p: Point2): Bounds2 => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
    return { left: expandBounds(pointBounds(probeMarkers[0].point), PROBE_FRAME_PADDING_MM), right: expandBounds(pointBounds(probeMarkers[1].point), PROBE_FRAME_PADDING_MM) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeMarkers, board.bounds, currentProbeStep]);

  // A new step (not a split view) smoothly re-frames the camera on its markers; a split view fits each pane on its own instead.
  useEffect(() => {
    if (!probeGuide || splitView || probeMarkers.length === 0) return;
    const bounds = probeMarkers.length === 1
      ? expandBounds({ minX: probeMarkers[0].point.x, minY: probeMarkers[0].point.y, maxX: probeMarkers[0].point.x, maxY: probeMarkers[0].point.y }, PROBE_FRAME_PADDING_MM * 3)
      : expandBounds(boundsFromPoints(probeMarkers.map(marker => marker.point)), PROBE_FRAME_PADDING_MM * 2);
    command('fit-bounds', bounds);
    // The first (red/primary) probe decides the side when the two markers disagree — there is only one shared camera here.
    const wantSide = sideOfProbe(currentProbeStep?.probes[0]);
    if (wantSide && wantSide !== side) onSide(wantSide);
    // Only the step change re-frames the camera: `splitView`/`probeMarkers`/`command` are derived from (or stable across) that same step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeGuide?.currentStepId]);

  // A split view is two fully independent BoardCanvas instances (own camera, own pan/zoom, own minimap) side by side via
  // SplitLayout, rather than one canvas drawing two internal panes — so each pane gets live gestures and a correct minimap for
  // free, reusing exactly the single-pane code path twice instead of teaching it about more than one camera. Each needs its own
  // one-shot `fit-bounds` command (the shared `viewCommand`/`command()` from the shell drives only the non-split canvas below),
  // built locally with a nonce counter that mirrors the shell's own (Shell.tsx's `commandCounter`).
  const splitCommandCounter = useRef(0);
  const [splitCommands, setSplitCommands] = useState<{ left: ViewCommand & { automatic?: boolean }; right: ViewCommand & { automatic?: boolean } } | null>(null);
  useEffect(() => {
    if (!splitView) return;
    const base = (splitCommandCounter.current += 2);
    setSplitCommands({
      left: { type: 'fit-bounds', nonce: base - 1, bounds: splitView.left, automatic: true },
      right: { type: 'fit-bounds', nonce: base, bounds: splitView.right, automatic: true },
    });
  }, [splitView]);
  // Sticky for the session, like the sidebar widths: a deliberate resize should not keep resetting on the next probe step.
  const [splitRatio, setSplitRatio] = useState(RATIO_DEFAULT);
  // `splitView` is only non-null once both probes resolved (its own useMemo requires `probeMarkers.length === 2`), so pairing
  // `currentProbeStep.probes[0]/[1]` by index with the left/right pane below is safe here.
  const probeLeft = currentProbeStep?.probes[0];
  const probeRight = currentProbeStep?.probes[1];
  const sideLeft = sideOfProbe(probeLeft) ?? side;
  const sideRight = sideOfProbe(probeRight) ?? side;

  return <main className="canvas-pane" aria-label={t('canvas.region')} data-testid="board-pane">
    {splitView ? (
      <SplitLayout ratio={splitRatio} onRatio={setSplitRatio}
        leftLabel={t('probe.splitPaneA')} rightLabel={t('probe.splitPaneB')} dividerLabel={t('probe.splitDivider')} dividerHint={t('probe.splitHint')}
        dividerValueText={percent => t('probe.splitShare', { percent })}
        left={<div className="probe-split-pane">
          {probeLeft && <div className={`probe-split-badge probe-split-badge--${probeLeft.color}`}>
            <span className="probe-split-dot" aria-hidden="true">{probeLeft.color === 'red' ? '+' : '−'}</span>
            <strong className="mono">{probeLeft.label ?? probeLeft.pinId ?? probeLeft.componentId}</strong>
            <span className="probe-split-side">{t(sideLeft === 'top' ? 'side.top' : 'side.bottom')}</span>
          </div>}
          <BoardCanvas board={board} index={index} side={sideLeft} selectedComponentId={selection.componentId} selectedPinId={selection.pinId} selectedNet={netVisible ? selection.net : null} showLabels={settings.showLabels} showConnections={settings.showConnections}
            measureMode={measure} viewCommand={splitCommands?.left ?? null} theme={theme} motion={settings.motion} language={language} layers={probeLayers} onSelectComponent={onSelectComponent} onSelectPin={onSelectPin} />
        </div>}
        right={<div className="probe-split-pane">
          {probeRight && <div className={`probe-split-badge probe-split-badge--${probeRight.color}`}>
            <span className="probe-split-dot" aria-hidden="true">{probeRight.color === 'red' ? '+' : '−'}</span>
            <strong className="mono">{probeRight.label ?? probeRight.pinId ?? probeRight.componentId}</strong>
            <span className="probe-split-side">{t(sideRight === 'top' ? 'side.top' : 'side.bottom')}</span>
          </div>}
          <BoardCanvas board={board} index={index} side={sideRight} selectedComponentId={selection.componentId} selectedPinId={selection.pinId} selectedNet={netVisible ? selection.net : null} showLabels={settings.showLabels} showConnections={settings.showConnections}
            measureMode={measure} viewCommand={splitCommands?.right ?? null} theme={theme} motion={settings.motion} language={language} layers={probeLayers} onSelectComponent={onSelectComponent} onSelectPin={onSelectPin} />
        </div>}
      />
    ) : (
      // Withholding `initialCamera`/`onCameraRestore` while a guide is active matches the split panes (which never receive them at
      // all): BoardCanvas's own restore-on-mount effect calls `onCameraRestore` -> `setSide`, which otherwise races the side this
      // probe step just forced above and can silently flip it back to whatever the user was looking at before the guide started.
      <BoardCanvas board={board} index={index} side={side} selectedComponentId={selection.componentId} selectedPinId={selection.pinId} selectedNet={netVisible ? selection.net : null} showLabels={settings.showLabels} showConnections={settings.showConnections}
        measureMode={measure} viewCommand={viewCommand} initialCamera={probeGuide ? null : initialCamera} onCameraRestore={probeGuide ? undefined : onCameraRestore} onCameraChange={onCameraChange} theme={theme} motion={settings.motion} language={language} layers={probeLayers} onSelectComponent={onSelectComponent} onSelectPin={onSelectPin} onStatusChange={statusStore.publish} />
    )}
    <div className="canvas-top"><div className="side-switch" aria-label={t('canvas.sideSwitch')}><button type="button" aria-pressed={side === 'top'} data-testid="side-top" onClick={() => onSide('top')}><Layers2 size={15} />{t('side.top')}</button><button type="button" aria-pressed={side === 'bottom'} data-testid="side-bottom" onClick={() => onSide('bottom')}>{t('side.bottom')}</button></div>
      <div className="canvas-meta"><span data-testid="side-label">{t(side === 'top' ? 'canvas.sideLabelTop' : 'canvas.sideLabelBottom')}</span><LiveRotation store={statusStore} /><span>2D</span></div></div>
    {focusLayout && <FocusSearch api={api} inputRef={searchRef} onActivated={onSearchActivated} />}
    {measure && <div className="mode-pill" data-testid="measure-pill"><Ruler size={14} /><LiveMeasurement store={statusStore} fmt={fmt} prompt={t('measure.prompt')} /><button type="button" aria-label={t('measure.finish')} onClick={() => onMeasure(false)}><X size={14} /></button></div>}
    {focusLayout && recentSelections.length > 0 && <div className="quick-parts">{recentSelections.map(id => { const c = index.componentById.get(id); return c && <button type="button" key={id} className={'quick-part mono' + (id === selection.componentId ? ' selected' : '')} onClick={() => onLocate(id)}>{c.ref}</button>; })}</div>}
    <div className="canvas-bottom">
      <div className="tool-group"><Tool label={t('tool.zoomOut')} shortcut="−" onClick={() => command('zoom-out')}><Minus size={16} /></Tool><LiveZoom store={statusStore} /><Tool label={t('tool.zoomIn')} shortcut="+" onClick={() => command('zoom-in')}><Plus size={16} /></Tool><span className="tool-divider" /><Tool label={t('tool.fit')} shortcut="F" testId="fit-tool" onClick={() => command('fit')}><Scan size={16} /></Tool><Tool label={t('tool.rotate')} shortcut="R" onClick={() => command('rotate')}><RotateCw size={16} /></Tool></div>
      <div className="tool-group canvas-secondary-tools"><Tool label={t('tool.netHighlight')} active={netVisible && !!selection.net} disabled={!selection.net} onClick={() => onNetVisible(!netVisible)}><Route size={16} /></Tool><Tool label={t('tool.measure')} shortcut="M" testId="measure-tool" active={measure} onClick={() => onMeasure(!measure)}><Ruler size={16} /></Tool><Tool label={t('tool.labels')} shortcut="L" active={settings.showLabels} onClick={() => onSettings({ showLabels: !settings.showLabels })}><Tags size={16} /></Tool><Tool label={t('common.note')} shortcut="N" testId="note-tool-canvas" disabled={!selection.componentId} active={hasNote} onClick={onEditNote}><StickyNote size={16} /></Tool></div>
    </div>
  </main>;
}
