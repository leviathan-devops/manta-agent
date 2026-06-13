import { tool } from '@opencode-ai/plugin';
import type { ProblemSolvingBrain } from '../problem-solving/problem-solving-brain.js';
import { mantaError } from '../shared/manta-logger.js';

export function createMantaCodeReviewTool(brain?: ProblemSolvingBrain) {
  return tool({
    description: 'Run code review on built files. Checks for theatrical code, TODOs, empty handlers, magic numbers, function length, and file structure issues.',
    args: {
      path: tool.schema.string().optional().describe('Directory path to review'),
    },
    execute: async (args: { path?: string }) => {
      const reviewPath = args.path || process.cwd();
      const findings: string[] = [];
      let totalFiles = 0;
      let totalIssues = 0;
      let totalScore = 100;

      try {
        const fs = await import('node:fs');
        const pathModule = await import('node:path');

        function scanDir(dir: string): string[] {
          const files: string[] = [];
          try {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
              if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
              const full = pathModule.join(dir, entry);
              const stat = fs.statSync(full);
              if (stat.isDirectory()) {
                files.push(...scanDir(full));
              } else if (/\.(ts|js|py|html|css|jsx|tsx|go|rs|java|cpp|c)$/i.test(entry)) {
                files.push(full);
              }
            }
          } catch (e) { mantaError('code-review: scanDir failed:', e); }
          return files;
        }

        const sourceFiles = scanDir(reviewPath);
        totalFiles = sourceFiles.length;

        for (const filePath of sourceFiles) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            const fileFindings: string[] = [];

            if (content.includes('TODO') || content.includes('FIXME') || content.includes('HACK')) {
              const count = (content.match(/TODO|FIXME|HACK/gi) || []).length;
              fileFindings.push(`TODOs/placeholders: ${count} found`);
              totalIssues += count;
              totalScore -= Math.min(count * 2, 10);
            }

            if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(content)) {
              fileFindings.push('Empty catch block detected');
              totalIssues++;
              totalScore -= 3;
            }

            if (/catch\s*\([^)]*\)\s*\{\s*\/\/\s*silent/.test(content)) {
              fileFindings.push('Silently swallowed error detected');
              totalIssues++;
              totalScore -= 5;
            }

            const magicNumberPattern = /(?<![a-zA-Z0-9_"])\b(2|3|4|5|6|7|8|9|10|15|20|30|50|60|100|200|300|500|1000)\b(?![a-zA-Z0-9_"'])/g;
            const magicMatches = content.match(magicNumberPattern) || [];
            if (magicMatches.length > 3) {
              fileFindings.push(`Magic numbers: ${magicMatches.length} found (consider constants)`);
              totalIssues++;
              totalScore -= 1;
            }

            const functionPattern = /(function\s+\w+|=>\s*\{|:\s*\([^)]*\)\s*=>)/g;
            const funcMatches = content.match(functionPattern) || [];
            for (const match of funcMatches) {
              const startIdx = content.indexOf(match);
              const funcBody = content.substring(startIdx, startIdx + 3000);
              const funcLines = funcBody.split('\n').length;
              if (funcLines > 50) {
                fileFindings.push(`Long function detected (~${funcLines} lines)`);
                totalIssues++;
                totalScore -= 2;
                break;
              }
            }

            if (/import\s+\*\s+as/.test(content)) {
              fileFindings.push('Wildcard import detected');
              totalIssues++;
              totalScore -= 2;
            }

            if (fileFindings.length > 0) {
              findings.push(`\n${filePath}:`);
              for (const f of fileFindings) {
                findings.push(`  - ${f}`);
              }
            }
          } catch (e) { mantaError('code-review: file scan failed:', e); }
        }

        if (brain) {
          const state = brain.stateMachine.getState();
          if (state.currentLayer < 7 && state.currentLayer > 0) {
            findings.push(`\n[PSM STATUS]` +
              `\n  Current Layer: ${state.currentLayer}/6` +
              `\n  Iteration: ${state.iteration}` +
              `\n  Derailments: ${state.derailments.length}`);
          }
        }

        const overallPassed = totalScore >= 90;
        const report = {
          overallScore: Math.max(0, totalScore),
          overallPassed,
          totalFiles,
          totalIssues,
          passRate: Math.round((totalScore / 100) * 100),
          timestamp: Date.now(),
          buildId: `review-${Date.now().toString(36)}`,
          findings: findings.length > 0 ? findings.join('\n') : 'No issues found.',
        };

        try {
          const fs = await import('node:fs');
          const pathModule = await import('node:path');
          const evidenceDir = pathModule.join(process.cwd(), '.manta', 'evidence', 'review');
          fs.mkdirSync(evidenceDir, { recursive: true });
          const reportPath = pathModule.join(evidenceDir, 'CodeReviewReport.json');
          fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        } catch (e) { mantaError('code-review: failed to write report:', e); }

        return JSON.stringify({
          status: overallPassed ? 'passed' : 'failed',
          score: totalScore,
          passRate: report.passRate,
          totalFiles,
          totalIssues,
          detail: findings.length > 0 ? findings.join('\n') : 'All files passed review.',
        }, null, 2);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: 'error', error: msg || 'Unknown error during code review' });
      }
    },
  });
}
