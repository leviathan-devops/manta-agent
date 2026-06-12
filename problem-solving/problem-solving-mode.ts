import { ProblemSolvingBrain } from './problem-solving-brain.js';
import { CoordinatorV2 } from './coordinator-v2.js';
import { createPsModeStatusTool } from './tools/ps-mode-status.js';
import { createPsModeLayerTool } from './tools/ps-mode-layer.js';
import { createPsModeEvidenceTool } from './tools/ps-mode-evidence.js';
import { createPsModeDerailTool } from './tools/ps-mode-derail.js';
import { createPsModeDebugTool } from './tools/ps-mode-debug.js';

export interface ProblemSolvingInstance {
  brain: ProblemSolvingBrain;
  coordinator: CoordinatorV2;
  tools: Record<string, any>;
}

export function createProblemSolvingMode(basePath?: string): ProblemSolvingInstance {
  const brain = new ProblemSolvingBrain(basePath);
  const coordinator = new CoordinatorV2();
  coordinator.attach(brain);

  const tools = {
    'ps-mode-status': createPsModeStatusTool(brain),
    'ps-mode-layer': createPsModeLayerTool(brain),
    'ps-mode-evidence': createPsModeEvidenceTool(brain),
    'ps-mode-derail': createPsModeDerailTool(brain),
    'ps-mode-debug': createPsModeDebugTool(brain),
  };

  return { brain, coordinator, tools };
}

export { ProblemSolvingBrain } from './problem-solving-brain.js';
export { CoordinatorV2 } from './coordinator-v2.js';
export { ProblemSolvingStateMachine } from './state-machine.js';
export { AntiDerailmentEngine } from './anti-derailment.js';
export { ProblemSolvingLayer, ANTI_DERAILMENT_CHECKS, GATE_CRITERIA } from './types.js';
export type {
  IterationRecord,
  ProblemSolvingState,
  DerailmentRecord,
  DerailmentType,
  LayerOutput,
} from './types.js';
