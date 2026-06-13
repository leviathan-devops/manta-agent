import { tool } from '@opencode-ai/plugin';
import type { ProblemSolvingBrain } from '../problem-solving-brain.js';

export function createPsModeDebugTool(brain: ProblemSolvingBrain) {
  return tool({
    description: 'View debug log entries and save them to disk. Use after solving or when stuck to audit the process.',
    args: {
      action: tool.schema.string().optional().describe('Action: view (default) or save'),
      category: tool.schema.string().optional().describe('Filter by category (e.g. ERROR, WARN, INFO)'),
    },
    execute: async (args: { action?: string; category?: string }) => {
      let logs = brain.getDebugLog();

      if (args.category) {
        const cat = args.category.toUpperCase();
        logs = logs.filter((l: string) => l.includes(`[${cat}]`));
      }

      if (args.action === 'save') {
        brain.saveDebugLog();
        const state = brain.stateMachine.getState();
        return JSON.stringify({
          status: 'ok',
          output: `Debug log saved for iteration ${state.iteration}. ${logs.length} entries.`,
          entries: logs.length,
          iteration: state.iteration,
        });
      }

      const recentLogs = logs.slice(-50);

      return JSON.stringify({
        status: 'ok',
        output: recentLogs.join('\n'),
        total: logs.length,
        shown: recentLogs.length,
      });
    },
  });
}
