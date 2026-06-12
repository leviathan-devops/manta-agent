export enum ProblemSolvingLayer {
  LAYER_1 = 1,
  LAYER_2 = 2,
  LAYER_3 = 3,
  LAYER_4 = 4,
  LAYER_5 = 5,
  LAYER_6 = 6,
  COMPLETE = 7,
}

export type IterationId = string;

export interface LayerOutput {
  complete: boolean;
  content: Record<string, unknown>;
  passed: boolean;
  errors: string[];
}

export interface IterationRecord {
  id: IterationId;
  problemStatement: string;
  layers: {
    assumption?: LayerOutput;
    action?: LayerOutput;
    observation?: LayerOutput;
    gapAnalysis?: LayerOutput;
    metaReflection?: LayerOutput;
    verification?: LayerOutput;
  };
  outcome: 'resolved' | 'iterating' | 'escalate';
  startedAt: number;
  completedAt?: number;
}

export interface ProblemSolvingState {
  currentLayer: ProblemSolvingLayer;
  iteration: IterationId;
  layerAttempts: number;
  maxLayerAttempts: number;
  maxIterations: number;
  history: IterationRecord[];
  derailments: DerailmentRecord[];
}

export interface DerailmentRecord {
  type: DerailmentType;
  layer: ProblemSolvingLayer;
  evidence: string;
  blocked: boolean;
  timestamp: number;
}

export type DerailmentType =
  | 'host-fallback'
  | 'success-claim-without-proof'
  | 'mock-stub-suggestion'
  | 'blind-retry'
  | 'self-referencing-proof'
  | 'vague-assumption'
  | 'vague-action'
  | 'no-raw-evidence'
  | 'no-gap-analysis'
  | 'no-pattern-extraction'
  | 'syntax-only-verification';

export const DERAILMENT_SEVERITY: Record<DerailmentType, 'BLOCKER' | 'WARNING'> = {
  'host-fallback': 'BLOCKER',
  'success-claim-without-proof': 'BLOCKER',
  'mock-stub-suggestion': 'WARNING',
  'blind-retry': 'BLOCKER',
  'self-referencing-proof': 'BLOCKER',
  'vague-assumption': 'BLOCKER',
  'vague-action': 'BLOCKER',
  'no-raw-evidence': 'BLOCKER',
  'no-gap-analysis': 'BLOCKER',
  'no-pattern-extraction': 'WARNING',
  'syntax-only-verification': 'BLOCKER',
};

export interface GateCriteria {
  layer: ProblemSolvingLayer;
  requirements: Record<string, boolean>;
  evidenceRequired: string[];
}

export interface AntiDerailmentCheck {
  check: string;
  description: string;
  enforcedAt: ProblemSolvingLayer;
}

export const ANTI_DERAILMENT_CHECKS: AntiDerailmentCheck[] = [
  { check: 'No self-referencing proofs', description: 'JSON/files created by agent = invalid evidence', enforcedAt: ProblemSolvingLayer.LAYER_3 },
  { check: 'No it works without raw evidence', description: 'Must show actual output, not assessment', enforcedAt: ProblemSolvingLayer.LAYER_3 },
  { check: 'No vague testing', description: 'Must specify exact command + expected output', enforcedAt: ProblemSolvingLayer.LAYER_2 },
  { check: 'No blind retry', description: 'Gap analysis must inform next action', enforcedAt: ProblemSolvingLayer.LAYER_4 },
  { check: 'No pattern repeat without extraction', description: 'Layer 5 must extract pattern to prevent repeat', enforcedAt: ProblemSolvingLayer.LAYER_5 },
  { check: 'No syntax-only verification', description: 'Must execute in target environment', enforcedAt: ProblemSolvingLayer.LAYER_6 },
  { check: 'No host fallback', description: 'Host testing does not prove container behavior', enforcedAt: ProblemSolvingLayer.LAYER_3 },
  { check: 'No mock/stub instead of real test', description: 'Must use real environment', enforcedAt: ProblemSolvingLayer.LAYER_6 },
];

export const GATE_CRITERIA: Record<ProblemSolvingLayer, GateCriteria> = {
  [ProblemSolvingLayer.LAYER_1]: {
    layer: ProblemSolvingLayer.LAYER_1,
    requirements: {
      'Explicit Assumption': false,
      'Reasoning Chain': false,
      'Success Criteria': false,
      'Confirmation/Disproof Criteria': false,
    },
    evidenceRequired: ['01_ASSUMPTION.md'],
  },
  [ProblemSolvingLayer.LAYER_2]: {
    layer: ProblemSolvingLayer.LAYER_2,
    requirements: {
      'Exact Command': false,
      'Expected Output': false,
      'Environment State': false,
    },
    evidenceRequired: ['02_ACTION.md'],
  },
  [ProblemSolvingLayer.LAYER_3]: {
    layer: ProblemSolvingLayer.LAYER_3,
    requirements: {
      'Raw Evidence': false,
      'Logs Checked': false,
      'Expected vs Actual Comparison': false,
    },
    evidenceRequired: ['03_OBSERVATION.md'],
  },
  [ProblemSolvingLayer.LAYER_4]: {
    layer: ProblemSolvingLayer.LAYER_4,
    requirements: {
      'Gap Analysis': false,
      'Updated Hypothesis': false,
      'Next Action Tied to Insight': false,
    },
    evidenceRequired: ['04_GAP_ANALYSIS.md'],
  },
  [ProblemSolvingLayer.LAYER_5]: {
    layer: ProblemSolvingLayer.LAYER_5,
    requirements: {
      'What I Should Have Done': false,
      'Pattern Extracted': false,
      'Systemic Issue': false,
    },
    evidenceRequired: ['05_META_REFLECTION.md'],
  },
  [ProblemSolvingLayer.LAYER_6]: {
    layer: ProblemSolvingLayer.LAYER_6,
    requirements: {
      'Target Environment Execution': false,
      'Behavior Matches Requirement': false,
      'No Regressions': false,
    },
    evidenceRequired: ['06_VERIFICATION.md'],
  },
  [ProblemSolvingLayer.COMPLETE]: {
    layer: ProblemSolvingLayer.COMPLETE,
    requirements: {
      'All Layers Complete': false,
    },
    evidenceRequired: ['00_INDEX.md'],
  },
};
