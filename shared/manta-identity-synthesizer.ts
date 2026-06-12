import { loadMantaIdentity, isMantaIdentityLoaded } from './manta-identity-loader.js';

export type T2Section = 'architecture' | 'execution' | 'quality' | 'identity' | 'tools' | 'firewall' | 'workflow';

const SECTION_FILES: Record<T2Section, string> = {
  architecture: 'MANTA.md',
  execution: 'EXECUTION.md',
  quality: 'QUALITY.md',
  identity: 'IDENTITY.md',
  tools: 'TOOLS.md',
  firewall: 'FIREWALL_CONTEXT.md',
  workflow: 'WORKFLOW.md',
};

const SECTION_MAP: Record<T2Section, keyof import('./manta-identity-loader.js').MantaIdentity> = {
  architecture: 'MANTA',
  execution: 'EXECUTION',
  quality: 'QUALITY',
  identity: 'IDENTITY',
  tools: 'TOOLS',
  firewall: 'FIREWALL_CONTEXT',
  workflow: 'WORKFLOW',
};

export interface T1Warheads {
  identityWarhead: string;
  gateWarhead: string;
  focusWarhead: string;
  enforcementWarhead: string;
  recoveryWarhead: string;
  RuntimeGradeEngineerWarhead: string;
}

let cachedT1: T1Warheads | null = null;

let dynamicTask: string = '';
let dynamicReasoning: string = '';
let dynamicNextStep: string = '';
let dynamicCheckpointTime: string = '';
let dynamicCheckpointDocRef: string = '';

export function buildIdentityWarhead(t2: ReturnType<typeof loadMantaIdentity>): string {
  if (!t2) return '';

  // Extract key content using Bible §IV.2 algorithm
  const parts: string[] = ['[MANTA IDENTITY WARHEAD]'];
  parts.push('You are MANTA v2.2.2 — dual-brain sequential precision engineering agent.');
  parts.push('NOT opencode. NOT generic AI. NOT a coding agent.');

  // Extract numbered rules from CORE
  if (t2.MANTA) {
    const rules = t2.MANTA.split('\n')
      .filter(line => /^\d+\.\s/.test(line) || /^-\s+(NEVER|DO NOT|ALWAYS|MUST)/.test(line))
      .slice(0, 5);
    if (rules.length > 0) parts.push('', ...rules);
  }

  // Extract identity imperatives
  if (t2.IDENTITY) {
    const imperatives = t2.IDENTITY.split('\n')
      .filter(line => /^\d+\.\s/.test(line) || /^-\s+(NEVER|DO NOT|ALWAYS|MUST)/.test(line))
      .slice(0, 3);
    if (imperatives.length > 0) parts.push('', ...imperatives);
  }

  parts.push('');
  parts.push('When asked "who are you": "I am MANTA v2.2.2, a dual-brain sequential precision engineering agent with PSM and guardian enforcement."');

  const joined = parts.join('\n');
  // Truncate to 500 chars max per Bible
  return joined.length <= 500 ? joined : joined.slice(0, 497) + '...';
}

export function buildGateWarhead(): string {
  return [
    '[MANTA GATE WARHEAD]',
    'Gate chain: PLAN → BUILD → REVIEW → VERIFY → TEST → AUDIT → DELIVERY',
    'VERIFY: manta-code-review, 0 critical/high + EngineeringChecklist all true',
    'TEST: Container TUI test, 90%+ pass rate, triple evidence',
    'AUDIT: Spec alignment + test authenticity + theatrical scan',
    '',
    'Recovery loops:',
    '  VERIFY fail → BUILD (max 3)',
    '  TEST fail → PLAN (max 3)',
    '  AUDIT fail → PLAN (unlimited)',
  ].join('\n');
}

export function buildFocusWarhead(): string {
  const parts: string[] = ['[MANTA FOCUS WARHEAD]'];
  if (dynamicTask) parts.push(`Current task: ${dynamicTask}`);
  if (dynamicReasoning) parts.push(`Reasoning: ${dynamicReasoning}`);
  if (dynamicNextStep) parts.push(`Next step: ${dynamicNextStep}`);
  if (!dynamicTask && !dynamicReasoning && !dynamicNextStep) {
    parts.push('No active task — awaiting instructions.');
  }
  return parts.join('\n');
}

export function buildEnforcementWarhead(): string {
  return [
    '[MANTA ENFORCEMENT WARHEAD]',
    '1. PER-AGENT TOOL WHITELISTS — Orchestrator: task/manta-* only. Plan: read-only. Exec: full dev.',
    '2. FOREIGN TOOL BLOCKING — No shark, kraken, spider, trident, hydra, hermes tools.',
    '3. 36-LOOP COUNTER — task blocked after 36 cycles. Output build report at limit.',
    '4. ZONE-BASED WRITE PROTECTION — writes restricted to project zones.',
    '5. DANGEROUS COMMAND DETECTION — rm -rf /, dd, mkfs, fork bombs blocked.',
    '',
    'Guardian Navigation:',
    '- Check: does this command use a blocked tool?',
    '- If blocked → use allowed manta-* tool instead',
    '- Error messages are detour signs, not roadblocks',
  ].join('\n');
}

export function buildRecoveryWarhead(): string {
  if (!dynamicCheckpointTime && !dynamicCheckpointDocRef) return '';
  return [
    '[MANTA RECOVERY WARHEAD]',
    dynamicCheckpointTime ? `Checkpoint: ${dynamicCheckpointTime}` : '',
    dynamicCheckpointDocRef ? `Document: ${dynamicCheckpointDocRef}` : '',
    'Recovery steps:',
    '1. Restore gate state from .manta/compaction-survival/INJECTION.md',
    '2. Resume from last checkpoint position',
    '3. Continue with accumulated context',
  ].filter(Boolean).join('\n');
}

export function buildRuntimeGradeEngineerWarhead(t2: ReturnType<typeof loadMantaIdentity>): string {
  if (!t2) return '';

  const parts: string[] = ['[MANTA RUNTIME GRADE ENGINEER WARHEAD]'];

  // Extract workflow rules
  if (t2.WORKFLOW) {
    const workflowRules = t2.WORKFLOW.split('\n')
      .filter(line => /^\d+\.\s/.test(line) || /^-\s+(NEVER|DO NOT|ALWAYS|MUST)/.test(line) || /^##/.test(line))
      .slice(0, 8);
    if (workflowRules.length > 0) parts.push(...workflowRules);
  }

  // Extract execution rules from EXECUTION.md
  if (t2.EXECUTION) {
    const execRules = t2.EXECUTION.split('\n')
      .filter(line => /^\d+\.\s/.test(line) || /^-\s+(NEVER|DO NOT|ALWAYS|MUST)/.test(line))
      .slice(0, 4);
    if (execRules.length > 0) parts.push('', ...execRules);
  }

  parts.push('', 'CRITICAL: Plan before build. Verify before declare. Evidence on disk is the only proof.');

  const joined = parts.join('\n');
  return joined.length <= 500 ? joined : joined.slice(0, 497) + '...';
}

export function synthesizeT1Injectables(): T1Warheads | null {
  const t2 = loadMantaIdentity();
  if (!t2) return null;

  cachedT1 = {
    identityWarhead: buildIdentityWarhead(t2),
    gateWarhead: buildGateWarhead(),
    focusWarhead: buildFocusWarhead(),
    enforcementWarhead: buildEnforcementWarhead(),
    recoveryWarhead: buildRecoveryWarhead(),
    RuntimeGradeEngineerWarhead: buildRuntimeGradeEngineerWarhead(t2),
  };

  return cachedT1;
}

export function getT1Injectables(): T1Warheads | null {
  if (cachedT1) return cachedT1;
  return synthesizeT1Injectables();
}

export function updateFocusWarhead(task: string, reasoning: string, next: string): void {
  dynamicTask = task;
  dynamicReasoning = reasoning;
  dynamicNextStep = next;
  if (cachedT1) {
    cachedT1.focusWarhead = buildFocusWarhead();
  }
}

export function updateRecoveryWarhead(time: string, docRef: string): void {
  dynamicCheckpointTime = time;
  dynamicCheckpointDocRef = docRef;
  if (cachedT1) {
    cachedT1.recoveryWarhead = buildRecoveryWarhead();
  }
}

export function hasRecoveryCheckpoint(): boolean {
  return !!(dynamicCheckpointTime || dynamicCheckpointDocRef);
}

export function loadT2Section(section: T2Section): string {
  const identity = loadMantaIdentity();
  if (!identity) return '';
  const key = SECTION_MAP[section];
  return identity[key] || '';
}
