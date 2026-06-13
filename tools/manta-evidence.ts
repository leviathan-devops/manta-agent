import { tool } from '@opencode-ai/plugin';
import { EvidenceCollector, type GateName } from '../shared/evidence.js';

const VALID_GATES: GateName[] = ['plan', 'build', 'review', 'verify', 'test', 'audit', 'delivery'];

function toGateName(raw: string): GateName {
  if (VALID_GATES.includes(raw as GateName)) return raw as GateName;
  throw new Error(`[MANTA] Invalid gate: "${raw}". Valid: ${VALID_GATES.join(', ')}`);
}

export function createMantaEvidenceTool(evidenceCollector: EvidenceCollector) {
  return tool({
    description: 'View evidence collection status and debug logs',
    args: {
      action: tool.schema.string().optional().describe('Action: status, gate-evidence, iteration-logs, or complete'),
      gate: tool.schema.string().optional().describe('Gate name to get evidence for'),
      iteration: tool.schema.string().optional().describe('Iteration identifier'),
    },
    execute: async (args: { action?: string; gate?: string; iteration?: string }) => {
      const { action, gate, iteration } = args;

      if (action === 'status') {
        const complete = evidenceCollector.hasCompleteEvidence();
        const gateStatuses: Record<string, { count: number; latest: string | null }> = {};

        for (const g of VALID_GATES) {
          const evidence = evidenceCollector.getGateEvidence(g);
          gateStatuses[g] = {
            count: evidence.length,
            latest: (evidence as Array<{ timestamp?: number }>)[0]?.timestamp
              ? new Date((evidence as Array<{ timestamp?: number }>)[0].timestamp!).toISOString()
              : null,
          };
        }

        return JSON.stringify({ complete, gates: gateStatuses }, null, 2);
      }

      if (action === 'gate-evidence') {
        if (!gate) {
          return JSON.stringify({ error: 'Gate required' });
        }
        const evidence = evidenceCollector.getGateEvidence(toGateName(gate));
        return JSON.stringify({ gate, evidence }, null, 2);
      }

      if (action === 'iteration-logs') {
        if (!iteration) {
          return JSON.stringify({ error: 'Iteration required' });
        }
        const logs = evidenceCollector.getIterationLogs(iteration);
        return JSON.stringify({ iteration, logs }, null, 2);
      }

      if (action === 'complete') {
        const complete = evidenceCollector.hasCompleteEvidence();
        return JSON.stringify({ complete }, null, 2);
      }

      return JSON.stringify({ error: 'Unknown action' });
    },
  });
}
