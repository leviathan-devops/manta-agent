import type { Hooks } from '@opencode-ai/plugin';
import { Guardian } from '../../shared/guardian.js';
import { getCurrentAgent } from './agent-state.js';

const ORCHESTRATOR_TOOLS = new Set(['task', 'manta-compaction', 'checkpoint', 'manta-status', 'manta-gate', 'manta-evidence', 'todowrite']);
const PLAN_TOOLS = new Set(['read', 'glob', 'grep', 'webfetch', 'question', 'manta-hive', 'manta-vision', 'manta-code-review', 'checkpoint', 'ps-mode-status', 'ps-mode-layer', 'ps-mode-evidence', 'ps-mode-derail', 'ps-mode-debug']);
const EXEC_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'glob', 'grep', 'manta-spawn-container', 'manta-test-runner', 'manta-runtime-audit', 'manta-code-audit', 'manta-code-review', 'manta-vision', 'checkpoint']);
const FOREIGN_IDENTIFIERS = ['shark', 'kraken', 'spider', 'trident', 'hydra', 'hermes', 'hive'];
function isForeignTool(tool: string): boolean {
  const lower = tool.toLowerCase();
  return FOREIGN_IDENTIFIERS.some(id => lower.includes(id)) && !lower.startsWith('manta');
}

export function createGuardianHook(guardian: Guardian): Hooks['tool.execute.before'] {
  return async (input, output) => {
    const inputRec = input as Record<string, unknown>;
    const sessionId = String(inputRec?.sessionID ?? '');
    const sessionObj = inputRec?.session as Record<string, unknown> | undefined;
    const agentFromInput = String(inputRec?.agent ?? inputRec?.agentName ?? sessionObj?.agentName ?? '');
    const agent = getCurrentAgent(sessionId) || agentFromInput || '';
    const tool = input?.tool || '';
    const outputRec = output as Record<string, unknown>;
    const args = (outputRec?.args ?? inputRec?.args ?? {}) as Record<string, unknown>;

    if (isForeignTool(tool)) {
      throw new Error(`BLOCKED: ${tool} not allowed. Use manta-* tools.`);
    }

    if (agent === 'manta') {
      if (!ORCHESTRATOR_TOOLS.has(tool)) {
        throw new Error(`BLOCKED: ${tool} denied. Use task(agent=manta-plan/exec).`);
      }
    } else if (agent === 'manta-plan') {
      if (!PLAN_TOOLS.has(tool)) throw new Error(`BLOCKED: Plan Brain read-only. ${tool} denied.`);
    } else if (agent === 'manta-exec') {
      if (!EXEC_TOOLS.has(tool)) throw new Error(`BLOCKED: Exec Brain cannot use ${tool}. Dev tools only.`);
    }

    // Manta-specific security checks — apply to all manta agents
    if (agent.startsWith('manta')) {
      if (tool === 'bash') {
        const command = String((args as Record<string, unknown>)?.command || (args as Record<string, unknown>)?.cmd || '');
        if (guardian.isDangerousCommand(command)) throw new Error(`BLOCKED: Dangerous cmd. Use task(agent=manta-exec).`);
      }
      if (tool === 'write' || tool === 'edit') {
        const filePath = String((args as Record<string, unknown>)?.filePath || '');
        if (filePath && !guardian.canWrite(filePath)) throw new Error(`BLOCKED: Cannot write to ${filePath} (zone restriction)`);
      }
    }
  };
}
