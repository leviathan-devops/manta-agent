import { tool } from '@opencode-ai/plugin';
import type { ProblemSolvingBrain } from '../problem-solving-brain.js';
import { ANTI_DERAILMENT_CHECKS, DERAILMENT_SEVERITY } from '../types.js';

export function createPsModeDerailTool(brain: ProblemSolvingBrain) {
  return tool({
    description: 'Check text for derailment patterns. Use this before submitting layer content to catch issues early.',
    args: {
      text: tool.schema.string().describe('Text to check for derailment patterns'),
    },
    execute: async (args: { text: string }) => {
      const layer = brain.stateMachine.getCurrentLayer();
      const findings = brain.detectDerailments(args.text);

      if (findings.length === 0) {
        return JSON.stringify({
          status: 'clean',
          output: 'No derailment patterns detected',
          layer,
        });
      }

      const blocked = findings.filter((f: { blocked: boolean }) => f.blocked);
      const warnings = findings.filter((f: { blocked: boolean }) => !f.blocked);

      return JSON.stringify({
        status: blocked.length > 0 ? 'blocked' : 'warnings',
        output: `Found ${findings.length} derailment(s): ${blocked.length} blocker(s), ${warnings.length} warning(s)`,
        findings,
        layer,
        antiDerailmentChecks: ANTI_DERAILMENT_CHECKS.filter((c: { check: string; description: string; enforcedAt: number }) => c.enforcedAt <= layer).map((c: { check: string; description: string; enforcedAt: number }) => c.check),
      });
    },
  });
}
