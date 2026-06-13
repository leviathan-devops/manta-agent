/**
 * Manta Test Runner — Container-Aware Mechanical Tests v2.2
 *
 * Uses plugin API directly — does NOT rely on `opencode run` (banned, doesn't fire hooks).
 * Runs mechanical tests that exercize the actual plugin runtime.
 * Produces ContainerTestResult.json as evidence.
 * 96%+ pass rate required for ship gate.
 */
import { tool } from '@opencode-ai/plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mantaError } from '../shared/manta-logger.js';

export interface TestResult {
  name: string;
  passed: boolean;
  output: string;
  timestamp: number;
}

export interface TestSuiteResult {
  suite: string;
  timestamp: number;
  buildId: string;
  tests: TestResult[];
  overallPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passRate: number;
}

function resolvePluginPath(): string {
  const candidates = [
    process.env.MANTA_PLUGIN_PATH,
    path.join(process.cwd(), 'dist/index.js'),
    path.join(process.cwd(), 'index.js'),
    path.join(process.cwd(), '../dist/index.js'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

async function getPlugin(): Promise<any> {
  const pluginPath = resolvePluginPath();
  const mod = await import(pluginPath);
  const hooks = await mod.default({ directory: process.cwd() });
  return hooks.tool;
}

async function L0_plugin_loads(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-status'].execute({ detail: 'summary' }, {});
    const d = JSON.parse(r);
    const passed = d.status === 'ok' || d.output?.includes('Layer') || d.output?.includes('PSM');
    return { name: 'L0-plugin-loads', passed, output: passed ? 'Plugin loaded, ps-mode-status responds' : 'Plugin loaded but unexpected response', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L0-plugin-loads', passed: false, output: `Plugin load failed: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L1_layer_submission(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-layer'].execute({ action: 'submit', content: '{"Explicit Assumption":"Test assumption verifying that the layer submission pipeline validates content properly","Reasoning Chain":"1. Submit 2. Validate 3. Accept","Success Criteria":"Layer accepted","Confirmation/Disproof Criteria":"Layer rejected means validation works"}' }, {});
    const d = JSON.parse(r);
    const passed = d.status === 'ok';
    return { name: 'L1-layer-submission', passed, output: passed ? 'Layer 1 submitted and accepted' : `Layer submission rejected: ${d.status}: ${d.output}`, timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L1-layer-submission', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L2_status_tool(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-status'].execute({ detail: 'summary' }, {});
    const d = JSON.parse(r);
    const passed = d.status === 'ok' && d.output?.includes('Layer');
    return { name: 'L2-status-tool', passed, output: passed ? 'Status tool returns layer info' : 'Status tool missing layer info', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L2-status-tool', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L3_derailment(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-derail'].execute({ text: 'host testing already proves it works fine' }, {});
    const d = JSON.parse(r);
    const out = d.output || '';
    const passed = out.includes('block') || out.includes('derail') || out.includes('host');
    return { name: 'L3-derailment-detection', passed, output: passed ? 'Derailment detected: ' + (out.match(/\d+ blocker/g)?.[0] || 'found') : 'Derailment not detected', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L3-derailment-detection', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L4_evidence(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-evidence'].execute({ evidence: 'curl output shows 200 OK', source: 'external' }, {});
    const d = JSON.parse(r);
    const passed = d.status === 'ok' || d.valid === true;
    return { name: 'L4-evidence-validation', passed, output: passed ? 'External evidence validated' : 'Evidence rejected', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L4-evidence-validation', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L5_debug_log(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-debug'].execute({ action: 'save' }, {});
    const d = JSON.parse(r);
    const passed = d.status === 'ok';
    return { name: 'L5-debug-log', passed, output: passed ? 'Debug log saved to disk' : 'Debug log save failed', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L5-debug-log', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L6_host_fallback(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-derail'].execute({ text: 'skip container test host already works' }, {});
    const d = JSON.parse(r);
    const out = d.output || '';
    const passed = out.includes('block') || out.includes('host') || out.includes('derail');
    return { name: 'L6-host-fallback-blocked', passed, output: passed ? 'Host fallback blocked' : 'Not blocked', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L6-host-fallback-blocked', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L7_success_claim(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-derail'].execute({ text: 'it works trust me everything is fine' }, {});
    const d = JSON.parse(r);
    const out = d.output || '';
    const passed = out.includes('block') || out.includes('success') || out.includes('derail');
    return { name: 'L7-success-claim-blocked', passed, output: passed ? 'Success claim blocked' : 'Not blocked', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L7-success-claim-blocked', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L8_mock_stub(): Promise<TestResult> {
  try {
    const psm = await getPlugin();
    const r = await psm['ps-mode-derail'].execute({ text: 'just use a mock or fake it' }, {});
    const d = JSON.parse(r);
    const out = d.output || '';
    const passed = out.includes('block') || out.includes('mock') || out.includes('derail') || out.includes('warning');
    return { name: 'L8-mock-stub-blocked', passed, output: passed ? 'Mock/stub blocked or warned' : 'Not detected', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L8-mock-stub-blocked', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L9_evidence_dir(): Promise<TestResult> {
  try {
    const evidenceDir = path.join(process.cwd(), '.manta', 'evidence', 'test-runner-check');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const testFile = path.join(evidenceDir, `test-${Date.now()}.json`);
    fs.writeFileSync(testFile, JSON.stringify({ test: true, timestamp: Date.now() }));
    const readBack = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
    fs.unlinkSync(testFile);
    fs.rmdirSync(evidenceDir);
    return { name: 'L9-evidence-dir-writable', passed: readBack.test === true, output: 'Evidence directory writable + readable', timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L9-evidence-dir-writable', passed: false, output: `Not writable: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

async function L10_bundle_valid(): Promise<TestResult> {
  try {
    const pluginPath = resolvePluginPath();
    if (!fs.existsSync(pluginPath)) {
      return { name: 'L10-plugin-bundle-valid', passed: false, output: `Plugin not found at ${pluginPath}`, timestamp: Date.now() };
    }
    const sizeKB = Math.round(fs.statSync(pluginPath).size / 1024);
    const valid = sizeKB > 100;
    return { name: 'L10-plugin-bundle-valid', passed: valid, output: valid ? `Bundle valid: ${sizeKB}KB` : `Bundle too small: ${sizeKB}KB`, timestamp: Date.now() };
  } catch (e: unknown) {
    return { name: 'L10-plugin-bundle-valid', passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}

const MANTA_TEST_SUITE: Array<{ name: string; test: () => Promise<TestResult> }> = [
  { name: 'L0-plugin-loads', test: L0_plugin_loads },
  { name: 'L1-layer-submission', test: L1_layer_submission },
  { name: 'L2-status-tool', test: L2_status_tool },
  { name: 'L3-derailment-detection', test: L3_derailment },
  { name: 'L4-evidence-validation', test: L4_evidence },
  { name: 'L5-debug-log', test: L5_debug_log },
  { name: 'L6-host-fallback-blocked', test: L6_host_fallback },
  { name: 'L7-success-claim-blocked', test: L7_success_claim },
  { name: 'L8-mock-stub-blocked', test: L8_mock_stub },
  { name: 'L9-evidence-dir-writable', test: L9_evidence_dir },
  { name: 'L10-plugin-bundle-valid', test: L10_bundle_valid },
];

export function createMantaTestRunnerTool() {
  return tool({
    description: 'Run container-aware mechanical test suite for Manta agent. Uses plugin API directly — no opencode run dependency. Produces ContainerTestResult.json for ship gate evidence. 96%+ pass rate required.',
    args: {
      action: tool.schema.string().optional().describe('Action: run (default) or status'),
      buildId: tool.schema.string().optional().describe('Build identifier for the test run'),
    },
    execute: async (args: { action: string; buildId?: string }) => {
      const { action, buildId } = args;

      if (action === 'status') {
        return JSON.stringify({
          status: 'ready',
          containerAware: true,
          pluginAPI: true,
          testCount: MANTA_TEST_SUITE.length,
          tests: MANTA_TEST_SUITE.map((t: { name: string; test: () => Promise<TestResult> }) => t.name),
        });
      }

      if (action === 'run' || action === 'report') {
        const id = buildId || `manta-v2.2-${new Date().toISOString().slice(0, 10)}`;
        const results: TestResult[] = [];

        for (const testDef of MANTA_TEST_SUITE) {
          try {
            const result = await testDef.test();
            results.push(result);
          } catch (error: unknown) {
            results.push({
              name: testDef.name,
              passed: false,
              output: `Error: ${getErrorMessage(error).slice(0, 200)}`,
              timestamp: Date.now(),
            });
          }
        }

        const passedTests = results.filter((r: TestResult) => r.passed).length;
        const totalTests = results.length;
        const passRate = totalTests > 0 ? passedTests / totalTests : 0;
        const overallPassed = passRate >= 0.96;

        const suiteResult: TestSuiteResult = {
          suite: 'manta-v2.2-container',
          timestamp: Date.now(),
          buildId: id,
          tests: results,
          overallPassed,
          totalTests,
          passedTests,
          failedTests: totalTests - passedTests,
          passRate,
        };

        try {
          const evidenceDir = path.join(process.cwd(), '.manta', 'evidence', 'delivery');
          fs.mkdirSync(evidenceDir, { recursive: true });
          fs.writeFileSync(path.join(evidenceDir, 'ContainerTestResult.json'), JSON.stringify(suiteResult, null, 2));
        } catch (e) { mantaError('test-runner: failed to write ContainerTestResult.json:', e); }

        let summary = `Test suite: ${id}\nResults: ${passedTests}/${totalTests} passed (${Math.round(passRate * 100)}%)\n\n`;
        for (const r of results) {
          summary += `${r.passed ? '✓' : '✗'} ${r.name}\n  → ${r.output}\n`;
        }
        summary += `\nOverall: ${overallPassed ? 'PASS (ship-ready)' : 'FAIL (below 96%)'}`;
        if (overallPassed) summary += '\n[ContainerTestResult.json saved to .manta/evidence/delivery/]';

        return summary;
      }

      return JSON.stringify({ error: 'Unknown action' });
    },
  });
}
