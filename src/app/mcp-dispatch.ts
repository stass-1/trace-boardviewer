import type { WorkspaceActions, WorkspaceState } from './api';
import type { ProbeGuide } from '../lib/probe-guide';

/** One board query/selection request from the AI agent bridge (electron/mcp-bridge.cjs). */
export type McpOutcome = { ok: true; result: unknown } | { ok: false; error: string };

function fail(error: unknown): McpOutcome {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * Answers one MCP bridge request against the live workspace. Pure function of (method, params, state,
 * actions) so it can be unit tested without Electron; useWorkspace.ts wires it to the real IPC channel.
 */
export function handleMcpRequest(method: string, params: Record<string, unknown> | undefined, state: WorkspaceState, actions: WorkspaceActions): McpOutcome {
  try {
    switch (method) {
      case 'status': {
        return {
          ok: true,
          result: {
            boardLoaded: Boolean(state.board),
            boardName: state.board?.name ?? null,
            boardPath: state.boardPath,
            componentCount: state.board?.components.length ?? 0,
            netCount: state.board?.nets.length ?? 0,
            selection: state.selection,
          },
        };
      }
      case 'listComponents': {
        if (!state.board) throw new Error('NO_BOARD: no board is loaded in the app yet.');
        const query = typeof params?.query === 'string' ? params.query.toLowerCase() : '';
        const limit = typeof params?.limit === 'number' && params.limit > 0 ? Math.min(params.limit, 1000) : 200;
        const items = state.board.components
          .filter(c => !query || c.ref.toLowerCase().includes(query) || (c.value ?? '').toLowerCase().includes(query) || (c.package ?? '').toLowerCase().includes(query))
          .slice(0, limit)
          .map(c => ({ id: c.id, ref: c.ref, value: c.value, package: c.package, side: c.side, pinCount: c.pinIds.length }));
        return { ok: true, result: items };
      }
      case 'getComponent': {
        if (!state.board || !state.boardIndex) throw new Error('NO_BOARD: no board is loaded in the app yet.');
        const id = String(params?.id ?? '');
        const component = state.boardIndex.componentById.get(id) ?? state.board.components.find(c => c.ref === id);
        if (!component) throw new Error(`NOT_FOUND: no component "${id}".`);
        const pins = state.boardIndex.pinsOf(component.id).map(p => ({ id: p.id, number: p.number, name: p.name, net: p.net }));
        return {
          ok: true,
          result: { id: component.id, ref: component.ref, value: component.value, package: component.package, side: component.side, position: component.position, rotation: component.rotation, pins },
        };
      }
      case 'getNet': {
        if (!state.board || !state.boardIndex) throw new Error('NO_BOARD: no board is loaded in the app yet.');
        const name = String(params?.name ?? '');
        const net = state.board.nets.find(n => n.name === name || n.id === name);
        const pins = state.boardIndex.pinsOfNet(net?.name ?? name);
        if (!net && pins.length === 0) throw new Error(`NOT_FOUND: no net "${name}".`);
        const members = pins.map(p => ({ pinId: p.id, componentId: p.componentId, number: p.number }));
        return { ok: true, result: { id: net?.id ?? null, name: net?.name ?? name, pinCount: members.length, pins: members } };
      }
      case 'highlightComponent': {
        const id = params?.id;
        actions.selectComponent(typeof id === 'string' ? id : null, { center: params?.center !== false, origin: 'search' });
        return { ok: true, result: null };
      }
      case 'highlightPin': {
        const id = String(params?.id ?? '');
        if (!id) throw new Error('BAD_PARAMS: "id" is required.');
        actions.selectPin(id, { center: params?.center !== false, origin: 'search' });
        return { ok: true, result: null };
      }
      case 'highlightNet': {
        const name = params?.name;
        actions.selectNet(typeof name === 'string' ? name : null, 'search');
        return { ok: true, result: null };
      }
      case 'clearHighlight': {
        actions.clearSelection();
        return { ok: true, result: null };
      }
      case 'loadProbeGuide': {
        const guide = params?.guide as ProbeGuide | undefined;
        if (!guide) throw new Error('BAD_PARAMS: "guide" is required.');
        actions.loadProbeGuide(guide);
        return { ok: true, result: null };
      }
      case 'probeGuideStatus': {
        const g = state.probeGuide;
        if (!g) return { ok: true, result: { active: false } };
        const step = g.guide.steps[g.currentStepId];
        return {
          ok: true,
          result: {
            active: true,
            guideTitle: g.guide.title,
            currentStepId: g.currentStepId,
            instruction: step?.instruction ?? null,
            mode: step?.mode ?? null,
            expected: step?.expected ?? null,
            choices: step?.choices.map(c => ({ key: c.key, label: c.label })) ?? [],
            history: g.history,
          },
        };
      }
      case 'clearProbeGuide': {
        actions.clearProbeGuide();
        return { ok: true, result: null };
      }
      default:
        throw new Error(`UNKNOWN_METHOD: "${method}".`);
    }
  } catch (error) {
    return fail(error);
  }
}
