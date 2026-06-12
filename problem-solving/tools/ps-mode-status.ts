import { tool } from '@opencode-ai/plugin';
import type { ProblemSolvingBrain } from '../problem-solving-brain.js';

export function createPsModeStatusTool(brain: ProblemSolvingBrain) {
  return tool({
    description: 'Show Problem Solving Mode status — current layer, iteration, derailments, and progress',
    args: {
      detail: tool.schema.string().optional().describe('Detail level: summary (default) or full'),
    },
    execute: async (args: { detail?: string }) => {
      const state = brain.getState();
      const record = brain.getCurrentRecord();
      const activity = brain.getActivityLog();
      const derailments = brain.stateMachine.getDerailments();

      const lines: string[] = [];
      lines.push('┌──────────────────────────────────────────────┐');
      lines.push('│     PROBLEM SOLVING MODE STATUS              │');
      lines.push('└──────────────────────────────────────────────┘');
      lines.push('');
      lines.push(`Layer: ${state.currentLayer === 7 ? 'COMPLETE' : `Layer ${state.currentLayer}`}`);
      lines.push(`Iteration: ${state.iteration}`);
      lines.push(`Attempts: ${state.layerAttempts}/${state.maxLayerAttempts}`);
      lines.push(`Total Iterations: ${state.history.length}`);
      lines.push(`Derailments: ${derailments.length}`);

      if (record) {
        lines.push('');
        lines.push(`Problem: ${record.problemStatement.substring(0, 120)}`);
        lines.push(`Outcome: ${record.outcome}`);
      }

      if (args.detail === 'full') {
        if (derailments.length > 0) {
          lines.push('');
          lines.push('── Derailments ──');
          for (const d of derailments) {
            lines.push(`  ${d.blocked ? '[BLOCKED]' : '[WARN]'} Layer ${d.layer}: ${d.type}`);
            lines.push(`    ${d.evidence}`);
          }
        }

        if (activity.length > 0) {
          lines.push('');
          lines.push('── Recent Activity ──');
          for (const a of activity.slice(-10)) {
            lines.push(`  Layer ${a.layer}: ${a.action} — ${a.output.substring(0, 80)}`);
          }
        }
      }

      return JSON.stringify({ status: 'ok', output: lines.join('\n') });
    },
  });
}
