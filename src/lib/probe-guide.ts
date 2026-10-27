import type { Bounds2, Point2 } from './geometry';

export type ProbeColor = 'red' | 'blue';
export type MeterMode = 'V_DC' | 'V_AC' | 'OHM' | 'CONTINUITY' | 'A_DC';

export interface ProbeMarker {
  color: ProbeColor;
  componentId: string;
  pinId?: string;       // specific pin; falls back to the component's first/center pin if absent
  label?: string;        // e.g. "GND", "+3VALW" — shown next to the marker
}

export interface ProbeChoice {
  key: string;            // '1'..'9'
  label: string;          // e.g. "~3.3V — норма"
  next: string | null;    // next step id, or null = this choice ends the guide
  verdict?: string;       // shown as the conclusion when next is null
}

export interface ProbeStep {
  id: string;
  instruction: string;    // short human-readable text for this step
  probes: ProbeMarker[];  // 1-2 entries
  mode: { type: MeterMode; range: string };  // e.g. {type:'V_DC', range:'20'}
  expected: string;       // e.g. "~3.3V"
  choices: ProbeChoice[];
}

export interface ProbeGuide {
  id: string;
  title: string;
  startStepId: string;
  steps: Record<string, ProbeStep>;
}

export interface ProbeGuideState {
  guide: ProbeGuide;
  currentStepId: string;
  history: Array<{ stepId: string; choiceKey: string }>;
}

/** The terminal choice that just ended a guide (probeGuide goes to null the same moment this is set), so a watcher of the push channel still learns which choice/verdict closed it. */
export interface ProbeGuideResult {
  guideTitle: string;
  stepId: string;
  choiceKey: string;
  choiceLabel: string;
  verdict?: string;
}

/** Builds the initial ProbeGuideState from a guide. Throws a clear Error if guide.steps[guide.startStepId] is missing (so an MCP caller gets a readable error). */
export function startProbeGuide(guide: ProbeGuide): ProbeGuideState {
  if (!guide.steps[guide.startStepId]) throw new Error(`Probe guide "${guide.id}" has no step "${guide.startStepId}" (startStepId).`);
  return { guide, currentStepId: guide.startStepId, history: [] };
}

/**
 * Pure: applies a keypress to the current guide state. Returns the SAME state object (not a new one) if the key isn't
 * a valid choice for the current step (a no-op, so callers can cheaply compare by reference). Appends to history and
 * moves currentStepId when valid; if the matched choice's `next` is null, currentStepId stays on the step that owns
 * the terminal choice. Also returns the SAME state object if `guide.steps[currentStepId]` is missing entirely.
 */
export function advanceProbeGuide(state: ProbeGuideState, choiceKey: string): ProbeGuideState {
  const step = state.guide.steps[state.currentStepId];
  if (!step) return state;
  const choice = step.choices.find(candidate => candidate.key === choiceKey);
  if (!choice) return state;
  const history = [...state.history, { stepId: step.id, choiceKey: choice.key }];
  return { guide: state.guide, currentStepId: choice.next ?? state.currentStepId, history };
}

/** Pure: steps back to the previous step in `state.history`, or returns the SAME state object when `history` is empty. */
export function stepBackProbeGuide(state: ProbeGuideState): ProbeGuideState {
  if (state.history.length === 0) return state;
  const previous = state.history[state.history.length - 1];
  if (!previous || !state.guide.steps[previous.stepId]) return state;
  return { guide: state.guide, currentStepId: previous.stepId, history: state.history.slice(0, -1) };
}

/**
 * Pure: resolves a step's probe markers to board-space points, given a lookup. A marker with a pinId resolves via
 * lookup.pin(pinId); without one, via lookup.component(componentId)'s bounds center. Markers whose target isn't
 * found by the lookup are skipped (not included in the result), never throw.
 */
export function resolveProbeMarkers(step: ProbeStep, lookup: { pin(id: string): Point2 | undefined; component(id: string): { bounds: Bounds2 } | undefined }): Array<{ color: ProbeColor; point: Point2; label?: string }> {
  const results: Array<{ color: ProbeColor; point: Point2; label?: string }> = [];
  for (const marker of step.probes) {
    const point = marker.pinId ? lookup.pin(marker.pinId) : boundsCenterOf(lookup.component(marker.componentId)?.bounds);
    if (!point) continue;
    results.push({ color: marker.color, point, ...(marker.label !== undefined ? { label: marker.label } : {}) });
  }
  return results;
}

function boundsCenterOf(bounds: Bounds2 | undefined): Point2 | undefined {
  if (!bounds) return undefined;
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
