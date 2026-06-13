import { tool } from '@opencode-ai/plugin';
import type { StateStore } from '../shared/state-store.js';
import type { GateManager } from '../shared/gates.js';

export function createMantaStatusTool(
  stateStore: StateStore,
  gateManager: GateManager,
  variant: 'manta' | 'macro' = 'manta'
) {
  return tool({
    description: 'Show current Manta v2.2.2 state: brain, gate, iteration, and evidence status',
    args: {},
    execute: async () => {
      const gateState = gateManager.getState();
      const currentGate = gateManager.getCurrentGate();
      const iteration = gateManager.getCurrentIteration();

      const macroState = stateStore.get<Record<string, unknown>>('manta-state', 'manta-state');
      const brainState = variant === 'manta'
        ? (String(macroState?.currentBrain ?? 'unknown'))
        : (Array.isArray(macroState?.activeBrains) ? (macroState.activeBrains as string[]).join(', ') : 'unknown');


      const evidence = gateManager.getEvidenceCollector();
      const evidenceStatus: Record<string, boolean> = {};
      const gates = ['plan', 'build', 'review', 'verify', 'test', 'audit', 'delivery'] as const;

      for (const gate of gates) {
        const latest = evidence.getLatestEvidence(gate);
        evidenceStatus[gate] = latest?.passed || false;
      }

      const status = {
        variant,
        brain: brainState,
        currentGate,
        iteration,
        gateStatuses: gateState.gateStatus,
        evidenceStatus,
        verifyAttempts: gateState.verifyAttempts,
      };

      return JSON.stringify(status, null, 2);
    },
  });
}
