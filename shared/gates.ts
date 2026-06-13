/**
 * Gates — Mechanical Enforcement Layer
 * 
 * Gate chain: PLAN → BUILD → REVIEW → VERIFY → TEST → AUDIT → DELIVERY
 * 
 * VERIFY failure triggers iteration loop:
 *   VERIFY fail → BUILD → REVIEW → VERIFY (max 3 attempts)
 *   After 3 failures → escalate to PLAN with new iteration (V1.0 → V1.1)
 */

import { EvidenceCollector, type GateName, type GateEvidence } from './evidence.js';

export type GateStatus = 'pending' | 'blocked' | 'passed' | 'failed';

export interface GateCriteria {
  gate: GateName;
  blockingCriteria: string[];
  evidenceRequired: string[];
}

export const GATE_CHAIN: GateName[] = ['plan', 'build', 'review', 'verify', 'test', 'audit', 'delivery'];

export const GATE_CRITERIA: Record<GateName, GateCriteria> = {
  plan: {
    gate: 'plan',
    blockingCriteria: [
      'Clear requirements defined',
      'SPEC.md generated',
      'Scope boundaries defined',
      'Acceptance criteria defined',
    ],
    evidenceRequired: ['SPEC.md', 'GuardianConfig.json'],
  },
  build: {
    gate: 'build',
    blockingCriteria: [
      'Files created per SPEC.md',
      'No scope violations',
      'Implementation matches spec',
    ],
    evidenceRequired: ['FileManifest.json', 'GitDiff.txt'],
  },
  review: {
    gate: 'review',
    blockingCriteria: [
      'No theatrical code patterns',
      'No TODOs or placeholders in production code',
      'No empty error handlers (catch {})',
      'No magic numbers without constants',
      'Function length ≤ 50 lines',
      'File structure matches SPEC.md',
      'Import surface is minimal (no wildcard imports)',
    ],
    evidenceRequired: ['CodeReviewReport.json'],
  },
  verify: {
    gate: 'verify',
    blockingCriteria: [
      'SPEC.md alignment verified',
      'No deviation from spec without documented reason',
      'Edge cases handled',
      'Error handling complete',
      'Code review passed (manta-code-review)',
    ],
    evidenceRequired: ['VerificationReport.json', 'CodeReviewReport.json'],
  },
  test: {
    gate: 'test',
    blockingCriteria: [
      'Container tests pass (96%+ pass rate)',
      'All hooks verified firing',
      'Identity verified in container',
      'No theatrical test patterns',
    ],
    evidenceRequired: ['ContainerTestResult.json'],
  },
  audit: {
    gate: 'audit',
    blockingCriteria: [
      'SAST clean (0 critical/high)',
      'No secrets detected',
      'Dependencies audited (no critical CVEs)',
    ],
    evidenceRequired: ['SASTReport.json', 'SecretsScan.json', 'AuditReport.json'],
  },
  delivery: {
    gate: 'delivery',
    blockingCriteria: [
      'All previous gates passed',
      'Evidence archived',
      'Checkpoint created',
    ],
    evidenceRequired: ['EvidenceArchive.zip', 'DeliverySummary.md'],
  },
};

export class GateManager {
  private currentGate: GateName = 'plan';
  private gateStatus: Record<GateName, GateStatus> = {
    plan: 'pending',
    build: 'pending',
    review: 'pending',
    test: 'pending',
    verify: 'pending',
    audit: 'pending',
    delivery: 'pending',
  };
  private verifyAttempts: number = 0;
  private currentIteration: string = 'V1.0';
  private evidenceCollector: EvidenceCollector;
  private iterationAttempts: Record<string, number> = {};
  private deadlockMaxRounds: number = 3;
  private gatePositions: Array<{ gate: GateName; agent: string; position: string; timestamp: number }> = [];

  constructor(basePath: string = '.manta') {
    this.evidenceCollector = new EvidenceCollector(basePath);
  }

  // Deadlock protocol: log a position for consensus building
  logPosition(gate: GateName, agent: string, position: string): { consensus: boolean; conservativeAction: string | null; message: string } {
    this.gatePositions.push({ gate, agent, position, timestamp: Date.now() });
    const positionsForGate = this.gatePositions.filter((p: { gate: GateName; agent: string; position: string; timestamp: number }) => p.gate === gate);

    if (positionsForGate.length >= this.deadlockMaxRounds) {
      const allBlock = positionsForGate.every((p: { gate: GateName; agent: string; position: string; timestamp: number }) => p.position === 'block');
      const allAllow = positionsForGate.every((p: { gate: GateName; agent: string; position: string; timestamp: number }) => p.position === 'allow');
      const isDeadlock = !allBlock && !allAllow;

      if (isDeadlock) {
        const conservativeAction = 'block';
        return {
          consensus: false,
          conservativeAction,
          message: `GATE DEADLOCK at ${gate} after ${positionsForGate.length} rounds. ` +
            `Positions: ${positionsForGate.map((p: { gate: GateName; agent: string; position: string; timestamp: number }) => `${p.agent}=${p.position}`).join(', ')}. ` +
            `Conservative outcome: ${conservativeAction}. Escalating.`,
        };
      }

      return {
        consensus: true,
        conservativeAction: allBlock ? 'block' : 'allow',
        message: `Consensus reached at ${gate}: ${allBlock ? 'block' : 'allow'}`,
      };
    }

    return {
      consensus: false,
      conservativeAction: null,
      message: `Position logged for ${gate} by ${agent}. Round ${positionsForGate.length}/${this.deadlockMaxRounds}.`,
    };
  }

  /**
   * Get current active gate
   * @returns Current gate name (plan|build|review|verify|test|audit|delivery)
   */
  getCurrentGate(): GateName {
    return this.currentGate;
  }

  /**
   * Get all gate statuses
   * @returns Record of gate names to their status
   */
  getGateStatuses(): Record<GateName, GateStatus> {
    return { ...this.gateStatus };
  }

  getCurrentIteration(): string {
    return this.currentIteration;
  }

  canTransition(to: GateName): boolean {
    const currentIndex = GATE_CHAIN.indexOf(this.currentGate);
    const targetIndex = GATE_CHAIN.indexOf(to);

    if (targetIndex <= currentIndex) return false;
    if (targetIndex > currentIndex + 1) return false;

    return true;
  }

  /**
   * Transition to a target gate
   * @param to - Target gate name
   * @returns true if transition succeeded
   * @throws If the source gate has not passed
   */
  transitionTo(to: GateName): boolean {
    if (!this.canTransition(to)) {
      return false;
    }

    this.gateStatus[this.currentGate] = 'passed';
    this.currentGate = to;
    this.gateStatus[to] = 'blocked';

    if (to === 'verify') {
      this.verifyAttempts = 0;
    }

    return true;
  }

  blockCurrentGate(): void {
    this.gateStatus[this.currentGate] = 'blocked';
  }

  passCurrentGate(): void {
    this.gateStatus[this.currentGate] = 'passed';
  }

  failCurrentGate(): void {
    this.gateStatus[this.currentGate] = 'failed';
  }

  getCriteria(gate: GateName): GateCriteria {
    return GATE_CRITERIA[gate];
  }

  getIterationAttempts(iteration: string): number {
    return this.iterationAttempts[iteration] || 0;
  }

  handleVerifyFailure(): { action: 'loop' | 'escalate'; iteration: string } {
    this.verifyAttempts++;
    this.iterationAttempts[this.currentIteration] = this.verifyAttempts;

    if (this.verifyAttempts >= 3) {
      return this.escalateToPlan();
    }

    return { action: 'loop', iteration: this.currentIteration };
  }

  private escalateToPlan(): { action: 'escalate'; iteration: string } {
    const parts = this.currentIteration.split(/(\d+)$/);
    const name = parts[0] || 'V';
    const numStr = parts[1] || '0';
    const nextNum = parseInt(numStr) + 1;
    this.currentIteration = `${name}${nextNum}`;

    this.verifyAttempts = 0;

    this.gateStatus = {
      plan: 'pending',
      build: 'pending',
      review: 'pending',
      test: 'pending',
      verify: 'pending',
      audit: 'pending',
      delivery: 'pending',
    };

    this.currentGate = 'plan';

    return { action: 'escalate', iteration: this.currentIteration };
  }

  getEvidenceCollector(): EvidenceCollector {
    return this.evidenceCollector;
  }

  isComplete(): boolean {
    return this.currentGate === 'delivery' && this.gateStatus['delivery'] === 'passed';
  }

  getState(): Record<string, unknown> {
    return {
      currentGate: this.currentGate,
      gateStatus: { ...this.gateStatus },
      verifyAttempts: this.verifyAttempts,
      currentIteration: this.currentIteration,
      iterationAttempts: { ...this.iterationAttempts },
    };
  }

  restore(state: Record<string, unknown>): void {
    if (typeof state.currentGate === 'string' && GATE_CHAIN.includes(state.currentGate as GateName)) {
      this.currentGate = state.currentGate as GateName;
    }
    if (typeof state.gateStatus === 'object' && state.gateStatus !== null) {
      this.gateStatus = state.gateStatus as Record<GateName, GateStatus>;
    }
    if (typeof state.verifyAttempts === 'number') {
      this.verifyAttempts = state.verifyAttempts;
    }
    if (typeof state.currentIteration === 'string') {
      this.currentIteration = state.currentIteration;
    }
    if (typeof state.iterationAttempts === 'object' && state.iterationAttempts !== null) {
      this.iterationAttempts = state.iterationAttempts as Record<string, number>;
    }
  }
}
