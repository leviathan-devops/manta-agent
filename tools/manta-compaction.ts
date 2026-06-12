import { tool } from '@opencode-ai/plugin';
import type { CompactionManager } from '../shared/compaction-manager.js';
import type { GateManager } from '../shared/gates.js';

function stringifyResult(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

export function createMantaCompactionTool(compactionManager: CompactionManager, gateManager?: GateManager) {
  return tool({
    description: 'Compaction survival: check token budget, view anchor status, or manually trigger state export',
    args: {
      action: tool.schema.string().describe('Action: status, export, or anchors'),
      activeTask: tool.schema.string().optional().describe('Active task description for export'),
      nextSteps: tool.schema.string().optional().describe('Next steps for export'),
    },
    execute: async (args: { action: string; activeTask?: string; nextSteps?: string }) => {
      const { action } = args;

      if (!compactionManager.isInitialized()) {
        compactionManager.initialize();
      }

      if (action === 'status') {
        return stringifyResult(compactionManager.getStatus());
      }

      if (action === 'export') {
        const gateState = gateManager
          ? { currentGate: gateManager.getCurrentGate(), currentIteration: gateManager.getCurrentIteration(), gateStatus: gateManager.getGateStatuses() }
          : { currentGate: 'unknown', currentIteration: 'V1.0', gateStatus: {} };
        const result = compactionManager.triggerExport(
          gateState,
          args.activeTask,
          args.nextSteps
        );
        return stringifyResult({
          status: 'ok',
          exportId: result.exportId,
          tier: result.tier,
          gate: result.gate,
          message: 'Manual export created. 5 memory anchors updated.',
        });
      }

      if (action === 'anchors') {
        const anchors: Record<string, string | null> = {};
        const names = ['COMPACTION_SURVIVAL.md', 'BUILD_STATE.md', 'DECISION_CHAIN.md', 'EVIDENCE_STATE.md', 'TASK_QUEUE.md'] as const;
        for (const name of names) {
          anchors[name] = compactionManager.readAnchor(name);
        }
        return stringifyResult({ status: 'ok', anchors });
      }

      return stringifyResult({ status: 'error', message: `Unknown action: ${action}` });
    },
  });
}
