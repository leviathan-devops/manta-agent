import type { Hooks } from '@opencode-ai/plugin';
import type { CompactionManager } from '../../shared/compaction-manager.js';
import type { GateManager } from '../../shared/gates.js';
import { isMantaAgent } from '../../shared/agent-identity.js';
import { getCurrentAgent } from './agent-state.js';

export function createCompactingHook(
  gateManager: GateManager,
  compactionManager?: CompactionManager
): Hooks['experimental.session.compacting'] {
  return async (input, output) => {
    const inputRec = input as Record<string, unknown>;
    const sessionObj = inputRec?.session as Record<string, unknown> | undefined;
    const agentName = getCurrentAgent() || String(inputRec?.agent ?? sessionObj?.agentName ?? '');
    if (!isMantaAgent(agentName)) return;
    if (!compactionManager) return;

    const { sessionID } = input;
    const gateState = gateManager.getState();

    try {
      const result = compactionManager.onCompacting(gateState, sessionID || 'unknown');

      const contextOutput = output as { context?: string[] };
      if (contextOutput.context) {
        contextOutput.context.push(
          `[MANTA COMPACTION] system.transform will re-inject identity on next message`,
          `[MANTA COMPACTION] T2 context library will reload from disk on next message`,
          `[MANTA COMPACTION] ALLOWLIST enforcement remains active — non-allowlisted tools still blocked`,
          `[MANTA COMPACTION] Recovery: read .manta/compaction-survival/COMPACTION_SURVIVAL.md first, then BUILD_STATE.md, DECISION_CHAIN.md, EVIDENCE_STATE.md, TASK_QUEUE.md`,
        );
      }
    } catch (err) {
      const contextOutput = output as { context?: string[] };
      if (contextOutput.context) {
        contextOutput.context.push(
          `[MANTA COMPACTION WARNING] Flush failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };
}
