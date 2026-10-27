#!/usr/bin/env node
// MCP server for TRACE Boardviewer. Talks to the running Electron app over the local control channel
// (electron/mcp-bridge.cjs), which must be enabled by launching the app with TRACE_MCP_BRIDGE=1.
//
// The control file (.mcp-bridge.json, next to this repo's electron/ and mcp-server/ folders) holds the
// loopback port and a bearer token the running app generated; this server reads it fresh on every call
// so it always talks to whichever instance is currently running (it is rewritten on each app launch).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const controlFilePath = path.join(here, '..', '.mcp-bridge.json');

function readControl() {
  try {
    return JSON.parse(readFileSync(controlFilePath, 'utf8'));
  } catch {
    return null;
  }
}

async function rpc(method, params = {}) {
  const control = readControl();
  if (!control) {
    throw new Error(
      'TRACE Boardviewer is not running with the agent bridge enabled. Start it with the TRACE_MCP_BRIDGE=1 ' +
      'environment variable set (e.g. `TRACE_MCP_BRIDGE=1 pnpm dev:desktop` or `TRACE_MCP_BRIDGE=1 pnpm start`), ' +
      'with a board open.',
    );
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${control.port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${control.token}` },
      body: JSON.stringify({ method, params }),
    });
  } catch (error) {
    throw new Error(`Could not reach the running TRACE Boardviewer app (${error.message}). Is it still open?`);
  }
  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.error || 'Unknown error from TRACE Boardviewer.');
  return payload.result;
}

function textResult(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

const ProbeMarkerSchema = z.object({
  color: z.enum(['red', 'blue']),
  componentId: z.string(),
  pinId: z.string().optional(),
  label: z.string().optional(),
});
const ProbeChoiceSchema = z.object({
  key: z.string(),
  label: z.string(),
  next: z.string().nullable(),
  verdict: z.string().optional(),
});
const ProbeStepSchema = z.object({
  id: z.string(),
  instruction: z.string(),
  probes: z.array(ProbeMarkerSchema).min(1).max(2),
  mode: z.object({ type: z.enum(['V_DC', 'V_AC', 'OHM', 'CONTINUITY', 'A_DC']), range: z.string() }),
  expected: z.string(),
  choices: z.array(ProbeChoiceSchema).min(1),
});
const ProbeGuideSchema = z.object({
  id: z.string(),
  title: z.string(),
  startStepId: z.string(),
  steps: z.record(ProbeStepSchema),
});

const server = new McpServer({ name: 'trace-boardviewer', version: '0.1.0' });

server.tool(
  'board_status',
  'Check whether a board is currently loaded in the running TRACE Boardviewer app, and get basic stats (component/net counts, current selection).',
  {},
  async () => textResult(await rpc('status')),
);

server.tool(
  'board_list_components',
  'List components on the board currently open in TRACE Boardviewer, optionally filtered by a case-insensitive substring matched against reference, value, or package.',
  { query: z.string().optional().describe('Substring to match against ref/value/package, e.g. "U3" or "100nF"'), limit: z.number().int().positive().max(1000).optional() },
  async ({ query, limit }) => textResult(await rpc('listComponents', { query, limit })),
);

server.tool(
  'board_get_component',
  'Get full detail for one component on the currently open board: its value, package, side, position, and every pin with its net.',
  { id: z.string().describe('Component id or reference designator, e.g. "U3" or "BAT1"') },
  async ({ id }) => textResult(await rpc('getComponent', { id })),
);

server.tool(
  'board_get_net',
  'Get every pin (and owning component) on one net of the currently open board, by net name, e.g. "GND".',
  { name: z.string() },
  async ({ name }) => textResult(await rpc('getNet', { name })),
);

server.tool(
  'board_highlight_component',
  'Select and highlight one component in the running TRACE Boardviewer window (and center the view on it), so the person looking at the app sees exactly which part is being discussed.',
  { id: z.string().describe('Component id or reference designator, e.g. "U3"'), center: z.boolean().optional().describe('Pan/zoom the view to the component (default true)') },
  async ({ id, center }) => { await rpc('highlightComponent', { id, center }); return textResult(`Highlighted component "${id}" in the app.`); },
);

server.tool(
  'board_highlight_pin',
  'Select and highlight one specific pin in the running TRACE Boardviewer window.',
  { id: z.string().describe('Pin id'), center: z.boolean().optional() },
  async ({ id, center }) => { await rpc('highlightPin', { id, center }); return textResult(`Highlighted pin "${id}" in the app.`); },
);

server.tool(
  'board_highlight_net',
  'Select and highlight an entire net (every pin/component on it) in the running TRACE Boardviewer window.',
  { name: z.string() },
  async ({ name }) => { await rpc('highlightNet', { name }); return textResult(`Highlighted net "${name}" in the app.`); },
);

server.tool(
  'board_clear_highlight',
  'Clear the current selection/highlight in the running TRACE Boardviewer window.',
  {},
  async () => { await rpc('clearHighlight'); return textResult('Cleared the highlight.'); },
);

server.tool(
  'board_probe_guide_load',
  'Load a probe guide (a branching sequence of multimeter-measurement steps) into the running TRACE Boardviewer app, so it starts walking the person through the first step.',
  { guide: ProbeGuideSchema },
  async ({ guide }) => {
    const result = await rpc('loadProbeGuide', { guide });
    const warnings = result?.warnings ?? [];
    const base = `Loaded probe guide "${guide.title}" (${Object.keys(guide.steps).length} steps).`;
    if (warnings.length === 0) return textResult(base);
    return textResult(`${base}\n\nWARNING — ${warnings.length} probe marker(s) will not render (bad pinId/componentId — re-check with board_get_component before retrying):\n${warnings.map(w => `- ${w}`).join('\n')}`);
  },
);

server.tool(
  'board_probe_guide_status',
  'Check whether a probe guide is active in the running TRACE Boardviewer app, and if so, get the current step\'s instruction, meter mode, expected reading, and available choices.',
  {},
  async () => textResult(await rpc('probeGuideStatus')),
);

server.tool(
  'board_probe_guide_watch_url',
  'Get a local WebSocket URL that pushes the running TRACE Boardviewer app\'s probe guide status the moment it changes (a choice is ' +
  'pressed, or the guide ends) — connect to it once (e.g. with a ws-capable monitor/subscription tool) instead of polling ' +
  'board_probe_guide_status in a loop. The first message after connecting is the guide\'s current status, even if nothing has changed ' +
  'yet; after that, one message per change. The socket closes if the app closes or the bridge restarts — reconnect by calling this ' +
  'tool again for a fresh token, then open a new connection.',
  {},
  async () => {
    const control = readControl();
    if (!control) {
      throw new Error(
        'TRACE Boardviewer is not running with the agent bridge enabled. Start it with TRACE_MCP_BRIDGE=1 set, with a board open.',
      );
    }
    return textResult({ url: `ws://127.0.0.1:${control.port}/probe-guide-events?token=${control.token}` });
  },
);

server.tool(
  'board_probe_guide_clear',
  'Clear the active probe guide in the running TRACE Boardviewer window.',
  {},
  async () => { await rpc('clearProbeGuide'); return textResult('Cleared the active probe guide.'); },
);

const transport = new StdioServerTransport();
await server.connect(transport);
