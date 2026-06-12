import { tool } from '@opencode-ai/plugin';
import type { ProblemSolvingBrain } from '../problem-solving-brain.js';
import { ProblemSolvingLayer, GATE_CRITERIA } from '../types.js';
import { mantaError } from '../../shared/manta-logger.js';

function parseContent(raw: string, layer: number): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch (e) { mantaError('ps-mode-layer: JSON parse failed, falling back to line parsing:', e); }

  const layerFieldNames: Record<number, string[]> = {
    1: ['Explicit Assumption', 'Reasoning Chain', 'Success Criteria', 'Confirmation/Disproof Criteria'],
    2: ['Exact Command', 'Expected Output', 'Environment State'],
    3: ['Raw Evidence', 'Logs Checked', 'Expected vs Actual Comparison'],
    4: ['Gap Analysis', 'Updated Hypothesis', 'Next Action Tied to Insight'],
    5: ['What I Should Have Done', 'Pattern Extracted', 'Systemic Issue'],
    6: ['Target Environment Execution', 'Behavior Matches Requirement', 'No Regressions'],
  };

  const fields = layerFieldNames[layer] || layerFieldNames[1];
  const result: Record<string, unknown> = {};
  const lines = raw.split('\n').filter((l: string) => l.trim().length > 0);

  if (lines.length === 1) {
    result[fields[0]] = lines[0].trim();
    return result;
  }

  for (let i = 0; i < Math.min(lines.length, fields.length); i++) {
    result[fields[i]] = lines[i].trim();
  }

  if (lines.length > fields.length) {
    result[fields[fields.length - 1]] = lines.slice(fields.length - 1).join('\n').trim();
  }

  return result;
}

export function createPsModeLayerTool(brain: ProblemSolvingBrain) {
  return tool({
    description: 'Submit layer output or check layer requirements. Use this to advance through the 6 problem-solving layers. Content can be JSON object OR plain text.',
    args: {
      action: tool.schema.string().optional().describe('Action: submit (default), current, or requirements'),
      content: tool.schema.string().optional().describe('Layer content to submit (JSON or plain text)'),
      layer: tool.schema.number().optional().describe('Layer number for requirements query'),
      problem: tool.schema.string().optional().describe('Problem statement for initialization'),
    },
    execute: async (args: { action?: string; content?: string; layer?: number; problem?: string }) => {
      if (args.action === 'current') {
        const layer = brain.stateMachine.getCurrentLayer();
        const criteria = GATE_CRITERIA[layer as ProblemSolvingLayer];
        return JSON.stringify({
          status: 'ok',
          output: `Current Layer: ${layer === 7 ? 'COMPLETE' : `Layer ${layer}`}\nRequirements: ${Object.keys(criteria?.requirements ?? {}).join(', ')}`,
          layer,
          requirements: criteria?.requirements ?? {},
        });
      }

      if (args.action === 'requirements') {
        const layerNum = args.layer ?? brain.stateMachine.getCurrentLayer();
        const criteria = GATE_CRITERIA[layerNum as ProblemSolvingLayer];
        if (!criteria) {
          return JSON.stringify({ status: 'error', output: `No criteria found for layer ${layerNum}` });
        }
        return JSON.stringify({
          status: 'ok',
          output: `Layer ${layerNum} Requirements:\n${Object.entries(criteria.requirements).map(([k, v]) => `  ${v ? '[REQUIRED]' : '[OPTIONAL]'} ${k}`).join('\n')}`,
          layer: layerNum,
          requirements: criteria.requirements,
          evidenceRequired: criteria.evidenceRequired,
        });
      }

      if (args.action === 'submit') {
        if (!args.content) {
          return JSON.stringify({ status: 'error', output: 'content required for submit' });
        }

        const currentLayer = brain.stateMachine.getCurrentLayer();
        const content = parseContent(args.content, currentLayer);

        // Initialize only if no record exists
        if (!brain.stateMachine.historyExists()) {
          const problemStatement = args.problem || (typeof content['Explicit Assumption'] === 'string' ? content['Explicit Assumption'] : '') || args.content.substring(0, 100);
          brain.initialize(problemStatement);
        }

        // Always ensure a record exists before proceeding
        brain.stateMachine.ensureRecord();
        const layerBefore = brain.stateMachine.getCurrentLayer();

        const derailments = brain.detectDerailments(JSON.stringify(content));
        const blockers = derailments.filter((d: { blocked: boolean; type: string }) => d.blocked);
        if (blockers.length > 0) {
          return JSON.stringify({
            status: 'derailed',
            output: `BLOCKED by ${blockers.length} derailment(s): ${blockers.map((b: { blocked: boolean; type: string }) => b.type).join(', ')}`,
            derailments: blockers,
          });
        }

        brain.stateMachine.passLayer({ complete: true, content, passed: true, errors: [] });
        const layerAfter = brain.stateMachine.getCurrentLayer();

        if (layerAfter === layerBefore && layerBefore !== 7) {
          const attempts = brain.stateMachine.getLayerAttempts();
          const maxAttempts = brain.stateMachine.state.maxLayerAttempts;
          return JSON.stringify({
            status: 'validation_failed',
            output: `Layer ${layerBefore} validation failed. Attempt ${attempts}/${maxAttempts}. Check layer requirements and resubmit.`,
            layer: layerBefore,
            attempts,
            maxAttempts,
          });
        }

        return JSON.stringify({
          status: 'ok',
          output: `Layer passed. Current layer: ${layerAfter === 7 ? 'COMPLETE' : `Layer ${layerAfter}`}`,
          newLayer: layerAfter,
          isComplete: brain.stateMachine.isComplete(),
        });
      }

      return JSON.stringify({ status: 'error', output: 'Unknown action' });
    },
  });
}
