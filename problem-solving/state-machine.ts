import {
  ProblemSolvingLayer,
  type IterationId,
  type IterationRecord,
  type ProblemSolvingState,
  type DerailmentRecord,
  type DerailmentType,
  type LayerOutput,
} from './types.js';

export class ProblemSolvingStateMachine {
  state: ProblemSolvingState;

  constructor() {
    this.state = {
      currentLayer: ProblemSolvingLayer.LAYER_1,
      iteration: 'V1.0',
      layerAttempts: 0,
      maxLayerAttempts: 3,
      maxIterations: 10,
      history: [],
      derailments: [],
    };
  }

  initialize(problem: string): void {
    const record: IterationRecord = {
      id: this.state.iteration,
      problemStatement: problem,
      layers: {},
      outcome: 'iterating',
      startedAt: Date.now(),
    };

    this.state = {
      currentLayer: ProblemSolvingLayer.LAYER_1,
      iteration: 'V1.0',
      layerAttempts: 0,
      maxLayerAttempts: 3,
      maxIterations: 10,
      history: [record],
      derailments: [],
    };
  }

  getCurrentLayer(): ProblemSolvingLayer {
    return this.state.currentLayer;
  }

  getCurrentIteration(): IterationId {
    return this.state.iteration;
  }

  getCurrentRecord(): IterationRecord | undefined {
    return this.state.history[this.state.history.length - 1];
  }

  historyExists(): boolean {
    return this.state.history.length > 0;
  }

  ensureRecord(): IterationRecord {
    const existing = this.getCurrentRecord();
    if (existing) return existing;
    const record: IterationRecord = {
      id: this.state.iteration,
      problemStatement: 'auto-init',
      layers: {},
      outcome: 'iterating',
      startedAt: Date.now(),
    };
    this.state.history.push(record);
    return record;
  }

  recordDerailment(type: DerailmentType, layer: ProblemSolvingLayer, evidence: string, blocked: boolean): void {
    this.state.derailments.push({
      type,
      layer,
      evidence,
      blocked,
      timestamp: Date.now(),
    });
  }

  passLayer(output: LayerOutput): void {
    const record = this.ensureRecord();

    const layerMap: Record<number, keyof IterationRecord['layers']> = {
      1: 'assumption',
      2: 'action',
      3: 'observation',
      4: 'gapAnalysis',
      5: 'metaReflection',
      6: 'verification',
    };

    const key = layerMap[this.state.currentLayer];
    if (key) {
      record.layers[key] = output;
    }

    this.state.layerAttempts = 0;

    if (this.state.currentLayer === ProblemSolvingLayer.LAYER_6) {
      this.state.currentLayer = ProblemSolvingLayer.COMPLETE;
      record.outcome = 'resolved';
      record.completedAt = Date.now();
    } else {
      this.state.currentLayer = (this.state.currentLayer + 1) as ProblemSolvingLayer;
    }
  }

  failLayer(error: string): { action: 'retry' | 'escalate' | 'new-iteration' } {
    this.state.layerAttempts++;

    if (this.state.layerAttempts >= this.state.maxLayerAttempts) {
      const iterationNum = parseInt(this.state.iteration.replace('V', '').replace('.', ''));
      const nextIteration = `V${iterationNum + 1}.0`;

      if (iterationNum >= this.state.maxIterations) {
        const record = this.getCurrentRecord();
        if (record) record.outcome = 'escalate';
        return { action: 'escalate' };
      }

      const currentRecord = this.getCurrentRecord();
      if (currentRecord) {
        currentRecord.outcome = 'iterating';
        currentRecord.completedAt = Date.now();
      }

      this.state.iteration = nextIteration;
      this.state.currentLayer = ProblemSolvingLayer.LAYER_1;
      this.state.layerAttempts = 0;

      const newRecord: IterationRecord = {
        id: nextIteration,
        problemStatement: currentRecord?.problemStatement ?? '',
        layers: {},
        outcome: 'iterating',
        startedAt: Date.now(),
      };
      this.state.history.push(newRecord);

      return { action: 'new-iteration' };
    }

    return { action: 'retry' };
  }

  resetLayerAttempts(): void {
    this.state.layerAttempts = 0;
  }

  getLayerAttempts(): number {
    return this.state.layerAttempts;
  }

  isComplete(): boolean {
    return this.state.currentLayer === ProblemSolvingLayer.COMPLETE;
  }

  isStuck(): boolean {
    return this.state.history.some((r: { outcome: string }) => r.outcome === 'escalate');
  }

  getState(): ProblemSolvingState {
    return this.state;
  }

  getDerailments(): DerailmentRecord[] {
    return [...this.state.derailments];
  }

  getIterationCount(): number {
    return this.state.history.length;
  }

  getT1Prompt(): string {
    const record = this.getCurrentRecord();
    const layerNames: Record<number, string> = {
      1: 'LAYER 1: ASSUMPTION STATEMENT',
      2: 'LAYER 2: ACTION WITH PREDICTION',
      3: 'LAYER 3: OBSERVATION & EVIDENCE',
      4: 'LAYER 4: GAP ANALYSIS & ADJUSTMENT',
      5: 'LAYER 5: META-COGNITIVE REFLECTION',
      6: 'LAYER 6: VERIFICATION & CONFIRMATION',
    };

    const layerDesc: Record<number, string> = {
      1: 'State your explicit assumption. What do you believe? Why? What would prove you right or wrong?',
      2: 'Specify exact command/action and expected output BEFORE executing. Document environment state.',
      3: 'Show raw evidence (copy-paste output). Check logs. Compare expected vs actual.',
      4: 'Analyze the gap: "I expected X, got Y, therefore Z". Update hypothesis. Next action tied to insight.',
      5: 'Extract patterns. What should you have done differently? Identify systemic issues.',
      6: 'Verify in target environment. Check behavior matches requirement. Check regressions.',
    };

    const lines: string[] = [];
    lines.push(`[MANTA PSM v2.2.2 — Problem Solving Mode]`);
    lines.push('');
    lines.push(`Iteration: ${this.state.iteration}`);
    lines.push(`Current Layer: ${layerNames[this.state.currentLayer]}`);
    lines.push(`Layer Attempts: ${this.state.layerAttempts}/${this.state.maxLayerAttempts}`);
    lines.push(`Total Iterations: ${this.state.history.length}`);
    lines.push('');
    lines.push(`## Current Task`);
    lines.push(record?.problemStatement ?? 'No problem defined');
    lines.push('');
    lines.push(`## ${layerNames[this.state.currentLayer]}`);
    lines.push(layerDesc[this.state.currentLayer]);
    lines.push('');
    lines.push('## Anti-Derailment Rules');
    lines.push('1. You MUST show raw evidence — no paraphrasing, no assessments');
    lines.push('2. You MUST define expected output BEFORE executing');
    lines.push('3. Gap analysis MUST inform next action — no blind retries');
    lines.push('4. Verification MUST be in target environment — syntax check is NOT verification');
    lines.push('5. Self-created files are NOT valid evidence — only external system output counts');
    lines.push('');

    if (this.state.derailments.length > 0) {
      lines.push('## Previous Derailments (DO NOT REPEAT)');
      for (const d of this.state.derailments) {
        lines.push(`  ${d.blocked ? '[BLOCKED]' : '[WARN]'} ${d.type}: ${d.evidence}`);
      }
      lines.push('');
    }

    if (this.state.history.length > 1) {
      lines.push('## Iteration History');
      for (const h of this.state.history) {
        const status = h.outcome === 'resolved' ? '✓' : h.outcome === 'escalate' ? '⚠' : '…';
        lines.push(`  ${status} ${h.id}: ${h.problemStatement.substring(0, 80)}`);
      }
    }

    return lines.join('\n');
  }
}
