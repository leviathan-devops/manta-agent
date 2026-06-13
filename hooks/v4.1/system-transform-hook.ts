import type { Hooks } from '@opencode-ai/plugin';
import type { ProblemSolvingBrain } from '../../problem-solving/problem-solving-brain.js';
import { isMantaAgent } from '../../shared/agent-identity.js';
import { getCurrentAgent } from './agent-state.js';
import type { StateStore } from '../../shared/state-store.js';
import { getT1Injectables, hasRecoveryCheckpoint } from '../../shared/manta-identity-synthesizer.js';
import { formatMantaIdentityHeader } from '../../shared/manta-identity-header.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mantaError } from '../../shared/manta-logger.js';

let globalBrain: ProblemSolvingBrain | null = null;
let lastUserMessage: string = '';
let lastMantaAgent: string = '';

export function setProblemSolvingBrain(b: ProblemSolvingBrain): void { globalBrain = b; }
let mantaIdentityHeaderValue: string = '';
export function setMantaIdentityHeader(h: string): void { mantaIdentityHeaderValue = h; }
export function setLastUserMessage(msg: string): void { lastUserMessage = msg; }
export function setLastMantaAgent(agent: string): void { lastMantaAgent = agent; }

function updateSoCPreservation(): void {
  try {
    const dir = path.join(process.cwd(), '.manta', 'compaction-survival');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'SoC_PRESERVATION.md');
    const ts = new Date().toISOString();
    const entry = `### Injection: ${ts}\n- **Pattern:** Identity injected via system.transform\n- **Context:** Agent identity binding + T1 warheads applied\n- **Source:** system-transform-hook.ts\n\n`;
    let existing = '';
    try { existing = fs.readFileSync(filePath, 'utf-8'); } catch {}
    const lines = (entry + existing).split('\n');
    const truncated = lines.slice(0, 500).join('\n');
    fs.writeFileSync(filePath, truncated);
  } catch (e) {
    mantaError('Failed to update SoC_PRESERVATION.md:', e);
  }
}

export function createSystemTransformHook(stateStore?: StateStore): Hooks['experimental.chat.system.transform'] {
  return async (input: any, output: any) => {
    const sys = output as { system: string[] };
    if (!Array.isArray(sys.system)) return;
    
    const sessionId = input?.sessionID || '';
    const agentFromInput = (input as any)?.agent || (input as any)?.agentName || (input as any)?.session?.agentName || '';
    const agent = getCurrentAgent(sessionId) || agentFromInput || lastMantaAgent || '';
    
    // Track agent transitions
    const TRANSITION_KEY = 'manta-last-primary';
    let prevPrimary: string | undefined;
    try {
      prevPrimary = stateStore?.get(TRANSITION_KEY, 'manta-state') as string | undefined;
    } catch (e) {
      mantaError('system-transform: failed to read transition key:', e);
    }
    const currAgentName = agent || '';
    const currPrimary = currAgentName.split('-')[0].split('_')[0];
    const isNowManta = isMantaAgent(currAgentName) || currPrimary === 'manta';
    const wasOtherAgent = prevPrimary && prevPrimary !== 'manta' && prevPrimary !== currPrimary;

    // If NOT a manta agent, strip manta patterns and return
    if (!isMantaAgent(agent)) {
      const mantaPatterns = [
        /MANTA IDENTITY BINDING/i,
        /MANTA PSM MANDATE/i,
        /MANTA v?\d[\w.]*\s*IDENTITY/i,
        /You are MANTA/i,
        /WORKER SCOPE: manta-/i,
      ];
      for (let i = sys.system.length - 1; i >= 0; i--) {
        const s = sys.system[i];
        if (typeof s === 'string' && mantaPatterns.some((p: RegExp) => p.test(s))) {
          sys.system.splice(i, 1);
        }
      }
      if (currPrimary) {
        try { stateStore?.set(TRANSITION_KEY, currPrimary, 'manta-state'); } catch {}
      }
      return;
    }

    if (currPrimary) {
      try { stateStore?.set(TRANSITION_KEY, currPrimary, 'manta-state'); } catch (e) { mantaError('system-transform: failed to write transition key:', e); }
    }

    // ─── INFRASTRUCTURE: Clear & Rebuild ───
    // This is the universal identity infrastructure pattern from SPIDER:
    // 1. Clear the entire system array
    // 2. Rebuild from warheads in priority order
    // 3. Always re-inject — no dedup check
    
    // Collect warheads in priority order
    const warheads: string[] = [];
    
    // [0] Identity header (always first — who we are)
    warheads.push(formatMantaIdentityHeader());
    
    // [1-5] T1 warheads from synthesizer
    try {
      const t1 = getT1Injectables();
      if (t1) {
        if (t1.RuntimeGradeEngineerWarhead) warheads.push(t1.RuntimeGradeEngineerWarhead);
        if (t1.identityWarhead) warheads.push(t1.identityWarhead);
        if (t1.enforcementWarhead) warheads.push(t1.enforcementWarhead);
        if (t1.gateWarhead) warheads.push(t1.gateWarhead);
        if (t1.focusWarhead) warheads.push(t1.focusWarhead);
        if (hasRecoveryCheckpoint() && t1.recoveryWarhead) warheads.push(t1.recoveryWarhead);
      }
    } catch (e) {
      mantaError('Failed to get T1 injectables:', e);
    }
    
    // [6] Agent transition note (if applicable)
    if (isNowManta && wasOtherAgent) {
      warheads.push([
        `[AGENT TRANSITION — ${prevPrimary} → manta]`,
        `Previous primary agent: "${prevPrimary}". Current agent: "manta".`,
        `The conversation above was generated by "${prevPrimary}".`,
        `Respond as manta. Your identity: MANTA v2.2.2.`,
        `Do NOT identify as or continue work from "${prevPrimary}".`,
        `[END AGENT TRANSITION]`,
      ].join('\n'));
    }
    
    // [7] Worker-scoped identity for subagents
    if (agent === 'manta-plan') {
      warheads.push([
        '[WORKER SCOPE: manta-plan — Read-Only Analysis Brain]',
        'You are the MANTA Plan Brain — a read-only analysis and planning subagent.',
        'You CANNOT write code, edit files, or run bash commands.',
        'Your tools: read, glob, grep, webfetch, manta-hive, manta-vision, manta-code-review, ps-mode-*, checkpoint.',
        'You MUST use PSM (ps-mode-layer) for all analysis — start at Layer 1.',
        'Output JSON: analysis, executionPlan, gateCriteria.',
        'Return ONLY the JSON — no conversational fluff.',
        '[END WORKER SCOPE]',
      ].join('\n'));
    } else if (agent === 'manta-exec') {
      warheads.push([
        '[WORKER SCOPE: manta-exec — Execution Brain]',
        'You are the MANTA Execution Brain — a full-dev implementation subagent.',
        'You implement EXACTLY from the plan provided. No deviations.',
        'Your tools: read, write, edit, bash, glob, grep, manta-spawn-container, manta-test-runner, manta-runtime-audit, manta-code-audit, manta-code-review, manta-vision, checkpoint.',
        'If stuck, respond EXACTLY: EXECUTION_STUCK: <tried> | <happened> | <needed>',
        'Do NOT use task tool — only orchestrator spawns subagents.',
        '[END WORKER SCOPE]',
      ].join('\n'));
    }
    
    // [8] PSM mandate for plan brain
    if (agent === 'manta-plan') {
      warheads.push('[MANTA PSM MANDATE] You MUST use ps-mode-layer to advance through PSM layers. Start at Layer 1 (Assumption). Your first action must be to submit Layer 1 output using ps-mode-layer action=submit layer=1 content="<analysis>". Do NOT proceed without PSM layer submission.');
    }
    
    // ─── CLEAR and REBUILD ───
    // This is the critical infrastructure: clear the array in-place,
    // then rebuild from warheads. Don't patch around defaults.
    sys.system.length = 0;
    for (const w of warheads) {
      sys.system.push(w);
    }
    
    // Dynamic context after permanent warheads
    sys.system.push(`[MANTA v2.2.2] Agent: ${agent} | Gate: plan`);
    
    // Strip foreign identity patterns that may have been injected by other plugins
    const identityPatterns = [
      /SHARK\s+v?\d[\w.]*\s*IDENTITY/i,
      /KRAKEN\s+v?\d[\w.]*\s*IDENTITY/i,
      /TRIDENT\s+v?\d[\w.]*\s*IDENTITY/i,
      /SPIDER\s+v?\d[\w.]*\s*IDENTITY/i,
      /SHARK IDENTITY BINDING/i,
      /KRAKEN IDENTITY BINDING/i,
      /TRIDENT IDENTITY BINDING/i,
      /SPIDER IDENTITY BINDING/i,
      /HYDRA IDENTITY BINDING/i,
      /HERMES IDENTITY BINDING/i,
      /You are SHARK/i,
      /You are TRIDENT/i,
      /You are KRAKEN/i,
      /You are SPIDER/i,
    ];
    for (let i = sys.system.length - 1; i >= 0; i--) {
      const s = sys.system[i];
      if (typeof s === 'string') {
        const isNonManta = identityPatterns.some((p: RegExp) => p.test(s));
        if (isNonManta) {
          sys.system.splice(i, 1);
        }
      }
    }
    
    // Log identity injection
    updateSoCPreservation();
  };
}
