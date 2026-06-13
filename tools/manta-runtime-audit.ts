import { tool } from '@opencode-ai/plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mantaError } from '../shared/manta-logger.js';

export function createMantaRuntimeAuditTool(basePath: string = '.manta') {
  return tool({
    
    description: 'Runtime-grade audit for AUDIT gate. Checks container test evidence, theatrical patterns, freshness, and completeness. Returns pass/fail for each of 8 checks.',
    args: {
      action: tool.schema.string().optional().describe('Action: run (default) or status'),
    },
    execute: async (args: { action?: string }) => {
      const safeBase = typeof basePath === 'string' && basePath.startsWith('.') ? basePath : '.manta';
      if (args.action === 'status') {
        const statusPath = path.join(basePath, 'evidence', 'delivery', 'RuntimeAuditResult.json');
        if (fs.existsSync(statusPath)) {
          return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        }
        return { status: 'no-previous-audit' };
      }

      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
      const evidenceDir = path.join(safeBase, 'evidence');
      const deliveryDir = path.join(evidenceDir, 'delivery');

      // Check 1: ContainerTestResult.json exists
      const containerTestPath = path.join(deliveryDir, 'ContainerTestResult.json');
      if (fs.existsSync(containerTestPath)) {
        try {
          const ct = JSON.parse(fs.readFileSync(containerTestPath, 'utf-8'));
          checks.push({ name: 'container-test-evidence', passed: true, detail: `Found: passRate=${ct.passRate || 'unknown'}` });
        } catch {
          checks.push({ name: 'container-test-evidence', passed: false, detail: 'File exists but is not valid JSON' });
        }
      } else {
        checks.push({ name: 'container-test-evidence', passed: false, detail: 'No ContainerTestResult.json found in delivery evidence' });
      }

      // Check 2: Pass rate >= 96%
      if (checks[0].passed) {
        try {
          const ct = JSON.parse(fs.readFileSync(containerTestPath, 'utf-8'));
          const rate = ct.passRate ?? ct.pass_rate ?? 0;
          checks.push({ name: 'pass-rate', passed: rate >= 0.96, detail: `Pass rate: ${(rate * 100).toFixed(1)}% (required: ≥96%)` });
        } catch {
          checks.push({ name: 'pass-rate', passed: false, detail: 'Cannot parse pass rate' });
        }
      } else {
        checks.push({ name: 'pass-rate', passed: false, detail: 'Skipped: no container test evidence' });
      }

      // Check 3: Evidence freshness <= 24h
      if (fs.existsSync(deliveryDir)) {
        const files = fs.readdirSync(deliveryDir);
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        let freshCount = 0;
        for (const f of files) {
          const stat = fs.statSync(path.join(deliveryDir, f));
          if (now - stat.mtimeMs < dayMs) freshCount++;
        }
        checks.push({ name: 'evidence-freshness', passed: freshCount > 0, detail: `${freshCount}/${files.length} files fresh (<24h)` });
      } else {
        checks.push({ name: 'evidence-freshness', passed: false, detail: 'No delivery evidence directory' });
      }

      // Check 4: No theatrical patterns in evidence
      let theatricalFound = false;
      const theatricalPatterns = /\b(theatrical|stub|fake|mock data|placeholder|hardcoded.*test|dummy)\b/i;
      function scanDir(dir: string, depth: number = 0) {
        if (depth > 2 || theatricalFound) return;
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
          if (theatricalFound) break;
          const full = path.join(dir, entry);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) scanDir(full, depth + 1);
          else if (entry.endsWith('.json') || entry.endsWith('.md')) {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              if (theatricalPatterns.test(content)) {
                theatricalFound = true;
              }
            } catch (e) { mantaError('runtime-audit: theatrical scan read failed:', e); }
          }
        }
      }
      scanDir(evidenceDir);
      checks.push({ name: 'no-theatrical', passed: !theatricalFound, detail: theatricalFound ? 'Theatrical patterns found in evidence' : 'No theatrical patterns detected' });

      // Check 5: TUI capture evidence exists
      const tuiPatterns = ['tui-', 'capture-pane', 'tmux'];
      let tuiFound = false;
      if (fs.existsSync(deliveryDir)) {
        for (const f of fs.readdirSync(deliveryDir)) {
          if (tuiPatterns.some(p => f.toLowerCase().includes(p))) {
            tuiFound = true;
            break;
          }
        }
      }
      // Also check debug-logs for TUI evidence
      if (!tuiFound) {
        const debugDir = path.join(safeBase, 'debug-logs');
        if (fs.existsSync(debugDir)) {
          function checkDirForTui(dir: string) {
            for (const entry of fs.readdirSync(dir)) {
              const full = path.join(dir, entry);
              if (fs.statSync(full).isDirectory()) {
                for (const f of fs.readdirSync(full)) {
                  if (tuiPatterns.some(p => f.toLowerCase().includes(p))) { tuiFound = true; return; }
                }
              } else if (tuiPatterns.some(p => entry.toLowerCase().includes(p))) {
                tuiFound = true; return;
              }
            }
          }
          checkDirForTui(debugDir);
        }
      }
      checks.push({ name: 'tui-evidence', passed: tuiFound, detail: tuiFound ? 'TUI capture evidence found' : 'No TUI capture evidence found — run container TUI test' });

      // Check 6: Hooks firing evidence
      const hookLogPath = path.join(safeBase, 'hook-executions.jsonl');
      const hooksFired = fs.existsSync(hookLogPath);
      checks.push({ name: 'hooks-fired', passed: hooksFired, detail: hooksFired ? 'Hook execution log found' : 'No hook log found — hooks may not be firing' });

      // Check 7: PSM artifacts exist (if PSM was activated)
      const psmDir = path.join(safeBase, '.problem-solving', 'iterations');
      const psmExists = fs.existsSync(psmDir);
      if (psmExists) {
        const iterations = fs.readdirSync(psmDir);
        checks.push({ name: 'psm-complete', passed: iterations.length > 0, detail: `PSM iterations: ${iterations.length}` });
      } else {
        checks.push({ name: 'psm-complete', passed: false, detail: 'PSM iterations not found — PSM may not have been activated' });
      }

      // Check 8: Code review passed
      const reviewPath = path.join(deliveryDir, 'CodeReviewReport.json');
      if (fs.existsSync(reviewPath)) {
        try {
          const review = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
          checks.push({ name: 'code-review', passed: review.overallPassed !== false, detail: `Code review: ${review.overallPassed !== false ? 'passed' : 'failed'}` });
        } catch {
          checks.push({ name: 'code-review', passed: false, detail: 'Code review file not valid JSON' });
        }
      } else {
        checks.push({ name: 'code-review', passed: false, detail: 'No code review report found — code review may not have been run' });
      }

      const passed = checks.filter((c: { name: string; passed: boolean; detail: string }) => c.passed).length;
      const total = checks.length;
      const overallPassed = passed === total;

      const result = {
        status: overallPassed ? 'passed' : 'failed',
        passed: overallPassed,
        checks,
        passRate: total > 0 ? passed / total : 0,
        summary: `${passed}/${total} checks passed`,
        timestamp: new Date().toISOString(),
      };

      // Write result
      try {
        fs.mkdirSync(deliveryDir, { recursive: true });
        fs.writeFileSync(path.join(deliveryDir, 'RuntimeAuditResult.json'), JSON.stringify(result, null, 2));
      } catch (e) {
        mantaError('runtime-audit: failed to write result:', e);
      }

      return result;
    },
  });
}
