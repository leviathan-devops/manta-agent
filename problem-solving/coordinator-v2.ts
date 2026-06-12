import { ProblemSolvingBrain, type BrainSignal } from './problem-solving-brain.js';
import { ProblemSolvingLayer } from './types.js';

export type MantaBrainType = 'plan' | 'build';

export interface CoordinatorState {
  currentBrain: MantaBrainType;
  executionMode: 'problem-solving' | 'legacy';
  switchReason: string;
  iteration: string;
  lastSwitchAt: number;
  switchCount: number;
}

export class CoordinatorV2 {
  private state: CoordinatorState;
  private brain: ProblemSolvingBrain | null = null;

  constructor() {
    this.state = {
      currentBrain: 'plan',
      executionMode: 'problem-solving',
      switchReason: 'session-start',
      iteration: 'V1.0',
      lastSwitchAt: Date.now(),
      switchCount: 0,
    };
  }

  attach(brain: ProblemSolvingBrain): void {
    this.brain = brain;
  }

  initialize(problem: string): void {
    if (this.brain) {
      this.brain.initialize(problem);
    }

    this.state = {
      currentBrain: 'plan',
      executionMode: 'problem-solving',
      switchReason: `new-problem: ${problem.substring(0, 80)}`,
      iteration: 'V1.0',
      lastSwitchAt: Date.now(),
      switchCount: 0,
    };
  }

  getContext(): string {
    if (!this.brain) return 'Problem Solving Brain not initialized';

    const brainContext = this.brain.getBrainT1();
    const coordinatorInfo = this.toContextString();

    return `${brainContext}\n\n${coordinatorInfo}`;
  }

  processSignal(signal: BrainSignal, payload?: unknown): string {
    if (!this.brain) return 'Brain not attached';

    const result = this.brain.processSignal(signal, payload);

    const layer = this.brain.stateMachine.getCurrentLayer();
    if (layer === ProblemSolvingLayer.LAYER_2 || layer === ProblemSolvingLayer.LAYER_6) {
      this.switchTo('build', `Layer ${layer} requires execution`);
    } else {
      this.switchTo('plan', `Layer ${layer} requires planning/reasoning`);
    }

    return result;
  }

  private switchTo(brain: MantaBrainType, reason: string): void {
    if (this.state.currentBrain === brain) return;
    this.state.currentBrain = brain;
    this.state.switchReason = reason;
    this.state.lastSwitchAt = Date.now();
    this.state.switchCount++;
  }

  getCurrentBrain(): MantaBrainType {
    return this.state.currentBrain;
  }

  shouldDelegateToBuild(): boolean {
    const layer = this.brain?.stateMachine.getCurrentLayer();
    return layer === ProblemSolvingLayer.LAYER_2 || layer === ProblemSolvingLayer.LAYER_6;
  }

  getState(): CoordinatorState {
    return { ...this.state };
  }

  toContextString(): string {
    const layers: Record<number, string> = {
      1: 'PLAN (assumption/reasoning)',
      2: 'BUILD (execute action)',
      3: 'PLAN (observe/analyze evidence)',
      4: 'PLAN (analyze gap)',
      5: 'PLAN (meta-reflect)',
      6: 'BUILD (verify in target env)',
    };

    const currentLayer = this.brain?.stateMachine.getCurrentLayer() ?? 1;

    return [
      '[COORDINATOR V2]',
      `  Active Brain: ${this.state.currentBrain.toUpperCase()}`,
      `  Mode: ${this.state.executionMode}`,
      `  Layer ${currentLayer}: ${(layers as Record<number, string>)[currentLayer] ?? 'Complete'}`,
      `  Switches: ${this.state.switchCount}`,
      `  Iteration: ${this.state.iteration}`,
    ].join('\n');
  }
}
