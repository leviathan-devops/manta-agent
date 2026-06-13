import type { Hooks } from '@opencode-ai/plugin';
import { setCurrentAgent, getCurrentAgent } from './agent-state.js';
import { setLastUserMessage, setLastMantaAgent } from './system-transform-hook.js';
import { isMantaAgent } from '../../shared/agent-identity.js';
import { getMantaIdentityPrompt } from '../../shared/manta-identity-loader.js';
import type { CompactionManager } from '../../shared/compaction-manager.js';

const identityQueryPattern = /\b(who are you|what are you|what model|which model|what is your name|identify yourself|your name|your purpose)\b/i;

export function createChatMessageHook(compactionManager?: CompactionManager): Hooks['chat.message'] {
  return async (input, output) => {
    const ctx = input as { agentName?: string; sessionID?: string; agent?: string; session?: { agentName?: string; sessionID?: string } };
    const agent = ctx.agentName || ctx.agent || ctx.session?.agentName || getCurrentAgent(ctx.sessionID) || '';
    const sessionId = ctx.sessionID || ctx.session?.sessionID || '';

    if (isMantaAgent(agent)) {
      const inputMsg = input as Record<string, unknown>;
      const messageObj = inputMsg?.message as Record<string, unknown> | undefined;
      const msg = String(messageObj?.content ?? '');
      setCurrentAgent(agent, sessionId || ctx.sessionID, msg);
      setLastMantaAgent(agent);
      if (msg && identityQueryPattern.test(msg)) {
        const identityPrompt = getMantaIdentityPrompt();
        if (identityPrompt) {
          (output as Record<string, unknown>).content = identityPrompt;
          return;
        }
      }
    } else if (agent) {
      setCurrentAgent(undefined, ctx.sessionID);
      setLastMantaAgent('');
    }

    const outputRec = output as Record<string, unknown>;
    const outMsgObj = outputRec?.message as Record<string, unknown> | undefined;
    const inMsgObj = (input as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
    const userMsg = String(outMsgObj?.content ?? inMsgObj?.content ?? '');
    if (userMsg) {
      setLastUserMessage(userMsg);
      if (compactionManager && typeof compactionManager.recordChatTurn === 'function') {
        compactionManager.recordChatTurn();
      }
    }
  };
}
