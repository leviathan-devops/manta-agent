import { tool } from '@opencode-ai/plugin';
import type { ProblemSolvingBrain } from '../problem-solving-brain.js';

export function createPsModeEvidenceTool(brain: ProblemSolvingBrain) {
  return tool({
    description: 'Validate evidence for the current layer. Checks if evidence is from an external source (valid) or self-created (invalid).',
    args: {
      evidence: tool.schema.string().describe('Evidence text to validate'),
      source: tool.schema.string().optional().describe('Source type: external or internal'),
    },
    execute: async (args: { evidence: string; source?: string }) => {
      const isExternal = args.source === 'external';
      const result = brain.antiDerailment.validateEvidence(args.evidence, isExternal);

      if (!result.valid) {
        const derail = brain.stateMachine.getDerailments();
        return JSON.stringify({
          status: result.valid ? 'ok' : 'invalid',
          output: result.reason ?? 'Evidence validation failed',
          derailmentCount: derail.length,
        });
      }

      return JSON.stringify({
        status: 'ok',
        output: 'Evidence is valid — from external source',
        source: args.source,
        length: args.evidence.length,
      });
    },
  });
}
