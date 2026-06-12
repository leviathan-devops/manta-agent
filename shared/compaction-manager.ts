/**
 * Manta Compaction Survival System v2.2 — Dense Proactive Edition
 *
 * Principles (from Kraken T2 + crash-recovery + compaction-survival patterns):
 *
 * 1. SURVIVAL FOLDER is created at session start with 5 living memory anchor docs
 * 2. Token budget is ESTIMATED (we can't see OpenCode's actual count) from tool calls
 * 3. Every 15% tier crossing triggers anchor updates + export
 * 4. Every gate advance / milestone triggers anchor updates + export
 * 5. session.compacting hook triggers final flush
 * 6. Post-compaction: read the 5 anchors in order → full state recovery
 *
 * 5 Memory Anchor Docs:
 *   COMPACTION_SURVIVAL.md  — "Read first" doc. Stream anchor + recovery protocol
 *   BUILD_STATE.md          — Phase, last completed, in-flight, next, errors
 *   DECISION_CHAIN.md       — Rolling reasoning trail (last 50 decisions)
 *   EVIDENCE_STATE.md       — Evidence collected, gates passed, chain continuity
 *   TASK_QUEUE.md           — What's done, what's in progress, what's next
 *
 * Token Estimation (we don't have access to OpenCode's token counter):
 *   - Each tool call ≈ 500 tokens (input + output + overhead)
 *   - Each chat turn ≈ 200 tokens (prompt + response delta)
 *   - Incremental estimation, capped at 170K (Claude context window)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mantaError } from './manta-logger.js';

// =====================================================================
// TYPES
// =====================================================================

export type TierName = 'green' | 'blue' | 'yellow' | 'orange' | 'red' | 'critical' | 'imminent';

export interface DecisionPoint {
  id: string;
  type: 'implementation' | 'architecture' | 'debug' | 'refactor' | 'gate' | 'milestone';
  description: string;
  contextFiles: string[];
  outcome?: string;
  timestamp?: number;
}

export interface TaskEntry {
  id: string;
  description: string;
  status: 'done' | 'in_progress' | 'pending' | 'blocked';
  timestamp: number;
}

export interface CompactionExport {
  exportId: string;
  timestamp: number;
  trigger: 'threshold' | 'milestone' | 'manual' | 'hook' | 'init';
  tier: TierName;
  gate: string;
  iteration: string;
}

export type TierCallback = (tier: TierName, tierIndex: number, ratio: number) => void;

// =====================================================================
// CONSTANTS
// =====================================================================

const TIERS: Array<{ name: TierName; min: number; label: string }> = [
  { name: 'green',    min: 0.00, label: 'GREEN (0-15%) — Fresh session' },
  { name: 'blue',     min: 0.15, label: 'BLUE (15-30%) — First checkpoint' },
  { name: 'yellow',   min: 0.30, label: 'YELLOW (30-45%) — Regular tracking' },
  { name: 'orange',   min: 0.45, label: 'ORANGE (45-60%) — Pre-compaction awareness' },
  { name: 'red',      min: 0.60, label: 'RED (60-75%) — Aggressive state export' },
  { name: 'critical', min: 0.75, label: 'CRITICAL (75-85%) — Full handover package' },
  { name: 'imminent', min: 0.85, label: 'IMMINENT (85%+) — Auto-compaction fires' },
];

const ANCHOR_FILES = [
  'COMPACTION_SURVIVAL.md',
  'BUILD_STATE.md',
  'DECISION_CHAIN.md',
  'EVIDENCE_STATE.md',
  'TASK_QUEUE.md',
] as const;

export type AnchorFileName = typeof ANCHOR_FILES[number];

// =====================================================================
// TOKEN ESTIMATOR
// =====================================================================

export class TokenEstimator {
  private estimatedTokens: number = 0;
  private maxTokens: number;
  private toolCallCount: number = 0;
  private chatTurnCount: number = 0;

  constructor(maxTokens: number = 170000) {
    this.maxTokens = maxTokens;
  }

  recordToolCall(outputSizeBytes: number = 0): void {
    this.toolCallCount++;
    const baseCost = 500;
    const outputCost = Math.min(outputSizeBytes / 4, 2000);
    this.estimatedTokens += Math.round(baseCost + outputCost);
    this.estimatedTokens = Math.min(this.estimatedTokens, this.maxTokens);
  }

  recordChatTurn(): void {
    this.chatTurnCount++;
    this.estimatedTokens += 200;
    this.estimatedTokens = Math.min(this.estimatedTokens, this.maxTokens);
  }

  setTokens(tokens: number): void {
    this.estimatedTokens = Math.min(tokens, this.maxTokens);
  }

  getEstimatedTokens(): number {
    return this.estimatedTokens;
  }

  getRatio(): number {
    return this.estimatedTokens / this.maxTokens;
  }

  getTier(): TierName {
    const ratio = this.getRatio();
    for (let i = TIERS.length - 1; i >= 0; i--) {
      if (ratio >= TIERS[i].min) return TIERS[i].name;
    }
    return 'green';
  }

  getTierIndex(): number {
    const ratio = this.getRatio();
    for (let i = TIERS.length - 1; i >= 0; i--) {
      if (ratio >= TIERS[i].min) return i;
    }
    return 0;
  }

  getStats(): { estimatedTokens: number; maxTokens: number; ratio: number; tier: TierName; toolCalls: number; chatTurns: number } {
    return {
      estimatedTokens: this.estimatedTokens,
      maxTokens: this.maxTokens,
      ratio: this.getRatio(),
      tier: this.getTier(),
      toolCalls: this.toolCallCount,
      chatTurns: this.chatTurnCount,
    };
  }
}

// =====================================================================
// COMPACTION MANAGER
// =====================================================================

export class CompactionManager {
  private folderPath: string;
  private estimator: TokenEstimator;
  private decisions: DecisionPoint[] = [];
  private tasks: TaskEntry[] = [];
  private lastTierIndex: number = -1;
  private lastAnchorUpdate: number = 0;
  private exportCount: number = 0;
  private initialized: boolean = false;
  private tierCallbacks: TierCallback[] = [];
  private currentGate: string = 'plan';
  private currentIteration: string = 'V1.0';
  private gateStatuses: Record<string, string> = {};
  private errorsUnsolved: string[] = [];

  constructor(workspaceDir: string) {
    this.folderPath = path.join(workspaceDir, '.manta', 'compaction-survival');
    this.estimator = new TokenEstimator(170000);
  }

  onTierCrossing(cb: TierCallback): void {
    this.tierCallbacks.push(cb);
  }

  // ---- LIFECYCLE ----

  initialize(gateState?: Record<string, unknown>): void {
    if (this.initialized) return;

    fs.mkdirSync(this.folderPath, { recursive: true });
    this.initialized = true;

    if (gateState) {
      this.currentGate = typeof gateState.currentGate === 'string' ? gateState.currentGate : 'plan';
      this.currentIteration = typeof gateState.currentIteration === 'string' ? gateState.currentIteration : 'V1.0';
      this.gateStatuses = (typeof gateState.gateStatus === 'object' && gateState.gateStatus !== null) ? gateState.gateStatus as Record<string, string> : {};
    }

    this.writeAllAnchors('init');

    this.exportCount++;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  hasAnchors(): boolean {
    return ANCHOR_FILES.every(f => fs.existsSync(path.join(this.folderPath, f)));
  }

  getFolderPath(): string {
    return this.folderPath;
  }

  // ---- PROACTIVE MONITORING (call from tool.execute.after) ----

  onToolCall(toolName: string, outputSizeBytes: number, gateState: Record<string, unknown>): void {
    if (!this.initialized) this.initialize(gateState);

    this.updateGateState(gateState);
    this.estimator.recordToolCall(outputSizeBytes);

    const newIndex = this.estimator.getTierIndex();
    if (newIndex > this.lastTierIndex && this.lastTierIndex >= 0) {
      for (const cb of this.tierCallbacks) {
        try { cb(this.estimator.getTier(), newIndex, this.estimator.getRatio()); } catch (e) { mantaError('compaction: tier callback failed:', e); }
      }
      this.writeAllAnchors('threshold');
      this.writeExport('threshold');
    }
    this.lastTierIndex = newIndex;

    const now = Date.now();
    if (now - this.lastAnchorUpdate > 10000) {
      this.lastAnchorUpdate = now;
      this.writeAllAnchors('periodic');
    }
  }

  // ---- CHAT TURN ----

  recordChatTurn(): void {
    this.estimator.recordChatTurn();
  }

  // ---- MILESTONE ----

  onMilestone(gateState: Record<string, unknown>, milestone: string): void {
    if (!this.initialized) this.initialize(gateState);

    this.updateGateState(gateState);

    this.decisions.unshift({
      id: `ms-${Date.now()}`,
      type: 'milestone',
      description: milestone,
      contextFiles: [],
      outcome: 'completed',
      timestamp: Date.now(),
    });
    if (this.decisions.length > 50) this.decisions.length = 50;

    this.writeAllAnchors('milestone');
    this.writeExport('milestone');
    this.exportCount++;
  }

  // ---- HOOK COMPACTION (session.compacting fires) ----

  onCompacting(gateState: Record<string, unknown>, sessionID: string): { export: CompactionExport; injection: string } {
    if (!this.initialized) this.initialize(gateState);

    this.updateGateState(gateState);
    this.writeAllAnchors('hook');

    const exportData: CompactionExport = {
      exportId: `hook-${Date.now()}`,
      timestamp: Date.now(),
      trigger: 'hook',
      tier: this.estimator.getTier(),
      gate: this.currentGate,
      iteration: this.currentIteration,
    };

    this.writeExport('hook');
    this.exportCount++;

    const injection = this.readAnchor('COMPACTION_SURVIVAL.md') || '';

    return { export: exportData, injection };
  }

  // ---- MANUAL EXPORT ----

  triggerExport(
    gateState: Record<string, unknown>,
    activeTask?: string,
    nextSteps?: string
  ): CompactionExport {
    if (!this.initialized) this.initialize(gateState);

    this.updateGateState(gateState);
    if (activeTask) this.addOrUpdateTask(activeTask, 'in_progress');
    if (nextSteps) this.addOrUpdateTask(nextSteps, 'pending');

    this.writeAllAnchors('manual');
    this.writeExport('manual');
    this.exportCount++;

    return {
      exportId: `manual-${Date.now()}`,
      timestamp: Date.now(),
      trigger: 'manual',
      tier: this.estimator.getTier(),
      gate: this.currentGate,
      iteration: this.currentIteration,
    };
  }

  // ---- DECISIONS ----

  addDecision(decision: DecisionPoint): void {
    decision.timestamp = decision.timestamp || Date.now();
    this.decisions.unshift(decision);
    if (this.decisions.length > 50) this.decisions.length = 50;
  }

  getDecisions(): DecisionPoint[] {
    return [...this.decisions];
  }

  // ---- TASKS ----

  addOrUpdateTask(description: string, status: TaskEntry['status']): void {
    const existing = this.tasks.find((t: TaskEntry) => t.description === description);
    if (existing) {
      existing.status = status;
      existing.timestamp = Date.now();
    } else {
      this.tasks.unshift({ id: `task-${Date.now()}`, description, status, timestamp: Date.now() });
      if (this.tasks.length > 30) this.tasks.length = 30;
    }
  }

  completeTask(description: string): void {
    const t = this.tasks.find((t: TaskEntry) => t.description === description);
    if (t) { t.status = 'done'; t.timestamp = Date.now(); }
  }

  // ---- ERRORS ----

  addError(error: string): void {
    this.errorsUnsolved.unshift(error);
    if (this.errorsUnsolved.length > 20) this.errorsUnsolved.length = 20;
  }

  resolveError(error: string): void {
    this.errorsUnsolved = this.errorsUnsolved.filter(e => e !== error);
  }

  // ---- STATUS ----

  getStatus(): {
    initialized: boolean;
    anchorsPresent: boolean;
    tokenEstimate: ReturnType<TokenEstimator['getStats']>;
    tier: TierName;
    decisionsCount: number;
    tasksCount: number;
    errorsCount: number;
    exportCount: number;
    currentGate: string;
    currentIteration: string;
    exportsOnDisk: string[];
  } {
    return {
      initialized: this.initialized,
      anchorsPresent: this.hasAnchors(),
      tokenEstimate: this.estimator.getStats(),
      tier: this.estimator.getTier(),
      decisionsCount: this.decisions.length,
      tasksCount: this.tasks.length,
      errorsCount: this.errorsUnsolved.length,
      exportCount: this.exportCount,
      currentGate: this.currentGate,
      currentIteration: this.currentIteration,
      exportsOnDisk: this.listExports(),
    };
  }

  // ---- ANCHOR READING ----

  readAnchor(name: AnchorFileName): string | null {
    const fp = path.join(this.folderPath, name);
    if (!fs.existsSync(fp)) return null;
    return fs.readFileSync(fp, 'utf-8');
  }

  // ---- INTERNALS ----

  private updateGateState(gateState: Record<string, unknown>): void {
    if (typeof gateState.currentGate === 'string') this.currentGate = gateState.currentGate;
    if (typeof gateState.currentIteration === 'string') this.currentIteration = gateState.currentIteration;
    if (typeof gateState.gateStatus === 'object' && gateState.gateStatus !== null) this.gateStatuses = gateState.gateStatus as Record<string, string>;
  }

  private writeExport(trigger: CompactionExport['trigger']): void {
    const dir = path.join(this.folderPath, `export-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });

    const data: CompactionExport = {
      exportId: `export-${Date.now()}`,
      timestamp: Date.now(),
      trigger,
      tier: this.estimator.getTier(),
      gate: this.currentGate,
      iteration: this.currentIteration,
    };

    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(dir, 'full-state.json'), JSON.stringify({
      gate: this.currentGate,
      iteration: this.currentIteration,
      gateStatuses: this.gateStatuses,
      decisions: this.decisions.slice(0, 10),
      tasks: this.tasks.slice(0, 10),
      errors: this.errorsUnsolved,
      tokenEstimate: this.estimator.getStats(),
    }, null, 2));
  }

  private listExports(): string[] {
    if (!fs.existsSync(this.folderPath)) return [];
    return fs.readdirSync(this.folderPath).filter((d: string) => d.startsWith('export-'));
  }

  private writeAllAnchors(trigger: string): void {
    fs.mkdirSync(this.folderPath, { recursive: true });

    const ts = new Date().toISOString();
    const tier = this.estimator.getTier();
    const tierLabel = TIERS.find((t: { name: TierName; min: number; label: string }) => t.name === tier)?.label || tier;

    this.writeAnchor('COMPACTION_SURVIVAL.md', this.renderCompactionSurvival(ts, tierLabel, trigger));
    this.writeAnchor('BUILD_STATE.md', this.renderBuildState(ts));
    this.writeAnchor('DECISION_CHAIN.md', this.renderDecisionChain(ts));
    this.writeAnchor('EVIDENCE_STATE.md', this.renderEvidenceState(ts));
    this.writeAnchor('TASK_QUEUE.md', this.renderTaskQueue(ts));
  }

  private writeAnchor(name: string, content: string): void {
    fs.writeFileSync(path.join(this.folderPath, name), content);
  }

  // ---- ANCHOR RENDERERS ----

  private renderCompactionSurvival(ts: string, tierLabel: string, trigger: string): string {
    return `# COMPACTION_SURVIVAL.md — READ THIS FIRST AFTER COMPACTION

> **IF IT'S NOT ON DISK, IT DIDN'T HAPPEN.**

## Stream Anchor

**Agent:** MANTA v2.2
**Time:** ${ts}
**Tier:** ${tierLabel}
**Trigger:** ${trigger}
**Gate:** ${this.currentGate} (${this.currentIteration})
**Exports written:** ${this.exportCount}

## Recovery Protocol

After compaction, read these files IN ORDER:

1. **THIS FILE** (COMPACTION_SURVIVAL.md) — you are here
2. **BUILD_STATE.md** — where were we in the build?
3. **DECISION_CHAIN.md** — what decisions were made?
4. **EVIDENCE_STATE.md** — what evidence exists?
5. **TASK_QUEUE.md** — what's next?

Then:
- Restore gate state from gate position
- Resume from ${this.currentGate} gate
- Continue task from BUILD_STATE.md

## Identity Reminder

You are **MANTA v2.2** — dual-brain sequential precision agent.
- NOT Shark, NOT Kraken, NOT generic
- Architecture: Plan Brain + Build Brain (sequential)
- 17 tools registered
- VERIFY gate before TEST gate (never skip)
- Guardian blocks all foreign tools

---
*Updated: ${ts} by ${trigger}*
`;
  }

  private renderBuildState(ts: string): string {
    const chain = ['plan', 'build', 'review', 'verify', 'test', 'audit', 'delivery'];

    const activeTask = this.tasks.find((t: TaskEntry) => t.status === 'in_progress');
    const lastDone = this.tasks.find((t: TaskEntry) => t.status === 'done');
    const nextPending = this.tasks.find((t: TaskEntry) => t.status === 'pending');

    return `# BUILD_STATE.md — Build Phase & Position

## Current Position
- **Gate:** ${this.currentGate}
- **Iteration:** ${this.currentIteration}

## Gate Chain
${chain.map((g: string) => {
      const status = this.gateStatuses[g] || 'pending';
      const marker = status === 'passed' ? '[x]' : status === 'failed' ? '[!]' : '[ ]';
      const current = g === this.currentGate ? ' ← CURRENT' : '';
      return `${marker} ${g}: ${status}${current}`;
    }).join('\n')}

## Active Task
${activeTask ? activeTask.description : 'None'}

## Last Completed
${lastDone ? lastDone.description : 'None'}

## Next
${nextPending ? nextPending.description : 'Continue from current gate'}

## Unsolved Errors
${this.errorsUnsolved.length > 0 ? this.errorsUnsolved.map((e: string) => `- ${e}`).join('\n') : 'None'}

## Token Budget
- **Estimated:** ${this.estimator.getEstimatedTokens()} / ${this.estimator.getStats().maxTokens}
- **Tier:** ${this.estimator.getTier()}
- **Tool calls this session:** ${this.estimator.getStats().toolCalls}

---
*Updated: ${ts}*
`;
  }

  private renderDecisionChain(ts: string): string {
    const recent = this.decisions.slice(0, 25);

    return `# DECISION_CHAIN.md — Reasoning Trail

## Recent Decisions (${recent.length}/${this.decisions.length})
${recent.length > 0
        ? recent.map((d: DecisionPoint, i: number) => {
          const t = d.timestamp ? new Date(d.timestamp).toISOString().substring(11, 19) : '??:??:??';
          return `${i + 1}. [${t}] [${d.type}] ${d.description}${d.outcome ? ` → ${d.outcome}` : ''}`;
        }).join('\n')
        : 'No decisions recorded yet'}

## Key Architectural Decisions
${this.decisions.filter((d: DecisionPoint) => d.type === 'architecture').slice(0, 5).map((d: DecisionPoint, i: number) =>
          `${i + 1}. ${d.description}${d.outcome ? ` → ${d.outcome}` : ''}`
        ).join('\n') || 'None'}

## Key Debug Decisions
${this.decisions.filter((d: DecisionPoint) => d.type === 'debug').slice(0, 5).map((d: DecisionPoint, i: number) =>
          `${i + 1}. ${d.description}${d.outcome ? ` → ${d.outcome}` : ''}`
        ).join('\n') || 'None'}

---
*Updated: ${ts}*
`;
  }

  private renderEvidenceState(ts: string): string {
    const chain = ['plan', 'build', 'review', 'verify', 'test', 'audit', 'delivery'];
    const passed = chain.filter((g: string) => this.gateStatuses[g] === 'passed');
    const failed = chain.filter((g: string) => this.gateStatuses[g] === 'failed');

    return `# EVIDENCE_STATE.md — Evidence Collection Status

## Gate Evidence
${chain.map((g: string) => {
      const status = this.gateStatuses[g] || 'pending';
      const evMarker = status === 'passed' ? 'COLLECTED' : status === 'failed' ? 'FAILED' : 'PENDING';
      return `- ${g}: ${evMarker}`;
    }).join('\n')}

## Summary
- **Gates passed:** ${passed.length}/7 (${passed.join(', ') || 'none'})
- **Gates failed:** ${failed.length} (${failed.join(', ') || 'none'})
- **Current gate:** ${this.currentGate}

## Evidence Chain Continuity
${passed.length > 0 ? 'Chain intact through: ' + passed.join(' → ') : 'No evidence collected yet'}

## Exports on Disk
${this.exportCount} exports written to compaction-survival folder

---
*Updated: ${ts}*
`;
  }

  private renderTaskQueue(ts: string): string {
    const done = this.tasks.filter((t: TaskEntry) => t.status === 'done');
    const inProgress = this.tasks.filter((t: TaskEntry) => t.status === 'in_progress');
    const pending = this.tasks.filter((t: TaskEntry) => t.status === 'pending');
    const blocked = this.tasks.filter((t: TaskEntry) => t.status === 'blocked');

    return `# TASK_QUEUE.md — Task Tracking

## In Progress
${inProgress.length > 0 ? inProgress.map((t: TaskEntry) => `- ${t.description}`).join('\n') : 'Nothing in progress'}

## Pending (Next Up)
${pending.length > 0 ? pending.map((t: TaskEntry) => `- ${t.description}`).join('\n') : 'No pending tasks'}

## Blocked
${blocked.length > 0 ? blocked.map((t: TaskEntry) => `- ${t.description}`).join('\n') : 'Nothing blocked'}

## Completed
${done.length > 0 ? done.slice(0, 15).map((t: TaskEntry) => `- [x] ${t.description}`).join('\n') : 'Nothing completed yet'}

## Token Budget Status
- **Estimated usage:** ${(this.estimator.getRatio() * 100).toFixed(1)}%
- **Tier:** ${this.estimator.getTier()}
- **Tool calls:** ${this.estimator.getStats().toolCalls}

---
*Updated: ${ts}*
`;
  }
}
