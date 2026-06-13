import type { Hooks } from '@opencode-ai/plugin';
import { Guardian } from '../../shared/guardian.js';
import { GateManager } from '../../shared/gates.js';
import { EvidenceCollector } from '../../shared/evidence.js';
import { createGuardianHook } from './guardian-hook.js';
import { createChatMessageHook } from './chat-message-hook.js';
import { createCompactingHook } from './compacting-hook.js';
import { createGateHook } from './gate-hook.js';
import { createSessionHook } from './session-hook.js';
import { createSystemTransformHook, setProblemSolvingBrain, setMantaIdentityHeader } from './system-transform-hook.js';
import { createMessagesTransformHook } from './messages-transform-hook.js';
import { trackToolCall } from '../../problem-solving/psm-activator.js';
import type { MantaCoordinator } from '../../manta/coordinator.js';
import type { StateStore } from '../../shared/state-store.js';
import type { MantaMessenger } from '../../shared/messenger.js';
import type { ProblemSolvingBrain } from '../../problem-solving/problem-solving-brain.js';
import type { CompactionManager } from '../../shared/compaction-manager.js';

export function createMantaHooks(
  guardian: Guardian,
  gateManager: GateManager,
  evidenceCollector: EvidenceCollector,
  coordinator: MantaCoordinator | undefined,
  stateStore: StateStore,
  messenger: MantaMessenger,
  psBrain?: ProblemSolvingBrain,
  identityHeader?: string,
  compactionManager?: CompactionManager
): Hooks {
  if (psBrain) {
    setProblemSolvingBrain(psBrain);
  }
  if (identityHeader) {
    setMantaIdentityHeader(identityHeader);
  }

  const gateHook = createGateHook(gateManager, evidenceCollector, coordinator);
  const guardianBefore = createGuardianHook(guardian);
  const chatHook = createChatMessageHook(compactionManager);
  const sessionHook = createSessionHook(
    gateManager, evidenceCollector, coordinator,
    stateStore, messenger, compactionManager
  );

  return {
    'event': sessionHook,
    'chat.message': chatHook,
    'tool.execute.before': guardianBefore,
    'tool.execute.after': async (input, output) => {
      const tool = input?.tool ?? '';
      const sessionID = input?.sessionID ?? 'default';
      const args = input?.args;
      const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? {});
      const result = output?.output;
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');
      const isError = resultStr.includes('"error"') || resultStr.includes('Error:') || resultStr.includes('error:');
      trackToolCall(sessionID, 'manta', tool, argsStr, resultStr, isError);

      if (compactionManager) {
        try {
          const outputSize = resultStr.length;
          const gateState = gateManager.getState();
          const gateBefore = gateState.currentGate;
          compactionManager.onToolCall(tool, outputSize, gateState);

          await gateHook?.(input, output);

          const gateAfter = gateManager.getState();
          if (gateAfter.currentGate !== gateBefore) {
            compactionManager.onMilestone(
              gateAfter,
              `Gate advanced: ${gateBefore} → ${gateAfter.currentGate}`
            );
          }
        } catch {
          await gateHook?.(input, output);
        }
      } else {
        await gateHook?.(input, output);
      }
    },
    'experimental.session.compacting': createCompactingHook(gateManager, compactionManager),
    'experimental.chat.system.transform': createSystemTransformHook(stateStore),
    'experimental.chat.messages.transform': createMessagesTransformHook(),
  };
}
