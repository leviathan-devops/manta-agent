import { tool } from '@opencode-ai/plugin';
import type { GateManager } from '../shared/gates.js';
import type { Guardian } from '../shared/guardian.js';
import type { GateName } from '../shared/evidence.js';

const VALID_GATES: GateName[] = ['plan', 'build', 'review', 'verify', 'test', 'audit', 'delivery'];

function parseGateName(raw: string | undefined, fallback: string): GateName {
  const candidate = raw || fallback;
  if (VALID_GATES.includes(candidate as GateName)) return candidate as GateName;
  throw new Error(`[MANTA] Invalid gate name: "${candidate}". Valid: ${VALID_GATES.join(', ')}`);
}

export function createMantaGateTool(
  gateManager: GateManager,
  guardian: Guardian
) {
  return tool({
    description: 'Evaluate a gate or get gate criteria',
    args: {
      action: tool.schema.string().optional().describe('Action: status, criteria, advance, or evaluate'),
      gate: tool.schema.string().optional().describe('Gate name (plan, build, review, verify, test, audit, delivery)'),
      passed: tool.schema.boolean().optional().describe('Whether the gate passed'),
      notes: tool.schema.string().optional().describe('Notes about the gate evaluation'),
    },
    execute: async (args: { action?: string; gate?: string; passed?: boolean; notes?: string }) => {
      const { action, gate, passed, notes } = args;

      if (action === 'status') {
        const statuses = gateManager.getGateStatuses();
        const current = gateManager.getCurrentGate();
        return JSON.stringify({ statuses, currentGate: current }, null, 2);
      }

      if (action === 'criteria') {
        const targetGate = parseGateName(gate, gateManager.getCurrentGate());
        const criteria = gateManager.getCriteria(targetGate);
        return JSON.stringify(criteria, null, 2);
      }

      if (action === 'advance') {
        const currentGate = gateManager.getCurrentGate();
        // If gate param is missing or same as current, advance to NEXT gate in chain
        let targetGate: GateName;
        if (!gate || gate === currentGate) {
          const currentIndex = VALID_GATES.indexOf(currentGate);
          if (currentIndex < 0 || currentIndex >= VALID_GATES.length - 1) {
            return JSON.stringify({ advanced: false, currentGate, error: 'Already at final gate' });
          }
          targetGate = VALID_GATES[currentIndex + 1];
        } else {
          targetGate = parseGateName(gate, currentGate);
        }
        const advanced = gateManager.transitionTo(targetGate);
        return JSON.stringify({
          advanced,
          from: currentGate,
          to: targetGate,
          currentGate: gateManager.getCurrentGate()
        }, null, 2);
      }

      if (action === 'evaluate') {
        if (!gate) {
          return JSON.stringify({ error: 'Gate required for evaluate action' });
        }

        const validatedGate = parseGateName(gate, gateManager.getCurrentGate());
        const evidence = gateManager.getEvidenceCollector();
        const gateEvidence = evidence.getLatestEvidence(validatedGate);

        if (passed !== undefined) {
          evidence.collectEvidence({
            gate: validatedGate,
            timestamp: Date.now(),
            passed: !!passed,
            files: [],
            metadata: { notes },
          });

          if (passed) {
            gateManager.passCurrentGate();
          } else {
            gateManager.failCurrentGate();
          }
        }

        // Compute next gate
        const currentGate = gateManager.getCurrentGate();
        const currentIndex = VALID_GATES.indexOf(currentGate);
        const nextGate = (currentIndex >= 0 && currentIndex < VALID_GATES.length - 1)
          ? VALID_GATES[currentIndex + 1]
          : null;

        // Auto-advance to next gate when passed=true AND there is a next gate
        let advanced = false;
        let advancedTo = null;
        if (passed && nextGate && gateManager.canTransition(nextGate)) {
          advanced = gateManager.transitionTo(nextGate);
          advancedTo = advanced ? nextGate : null;
        }

        const result = {
          gate: validatedGate,
          evaluated: true,
          passed: passed ?? gateEvidence?.passed ?? false,
          iteration: gateManager.getCurrentIteration(),
          advanced: advanced,
          advancedTo: advancedTo,
          currentGate: gateManager.getCurrentGate(),
          nextGate: nextGate,
          advanceHint: advanced
            ? `Advanced to ${nextGate}`
            : (nextGate ? `Use manta-gate action=advance gate=${nextGate} to proceed` : undefined),
        };

        return JSON.stringify(result, null, 2);
      }

      return JSON.stringify({ error: 'Unknown action' });
    },
  });
}
