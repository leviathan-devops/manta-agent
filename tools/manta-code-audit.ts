import { tool } from '@opencode-ai/plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mantaError } from '../shared/manta-logger.js';

export function createMantaCodeAuditTool(basePath: string = '.manta') {
  return tool({
    
    description: 'MANTA deep code audit for AUDIT gate. Scans source for critical/high findings. Returns structured results.',
    args: {
      action: tool.schema.string().optional().describe('Action: run (default) or status'),
      target: tool.schema.string().optional().describe('Target directory to audit'),
    },
    execute: async (args: { action?: string; target?: string }) => {
      const safeBase = typeof basePath === 'string' && basePath.startsWith('.') ? basePath : '.manta';
      if (args.action === 'status') {
        const statusPath = path.join(safeBase, 'evidence', 'delivery', 'CodeAuditResult.json');
        if (fs.existsSync(statusPath)) {
          return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        }
        return { status: 'no-previous-audit' };
      }

      const targetDir = args.target || './src';
      const findings: Array<{ severity: string; file: string; line: number; rule: string; detail: string }> = [];

      if (!fs.existsSync(targetDir)) {
        return { status: 'error', message: `Target directory not found: ${targetDir}` };
      }

      function scanFile(filePath: string) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const ext = path.extname(filePath);

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            const relPath = path.relative('.', filePath);

            // Critical: empty catch blocks
            if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || /catch\s*\{\s*\}/.test(line)) {
              findings.push({ severity: 'critical', file: relPath, line: lineNum, rule: 'empty-catch', detail: 'Empty catch block — error silently swallowed' });
            }

            // Critical: any type usage without guard
            if (ext === '.ts' && /:\s*any\b/.test(line) && !line.includes('// ') && !/\bas\s+any\b/.test(line)) {
              findings.push({ severity: 'high', file: relPath, line: lineNum, rule: 'any-type', detail: 'Unrestricted any type' });
            }

            // High: hardcoded paths
            if (/['"]\/(home|Users|root|tmp)\//.test(line) && !line.includes('process.env') && !line.includes('path.join')) {
              findings.push({ severity: 'high', file: relPath, line: lineNum, rule: 'hardcoded-path', detail: 'Hardcoded filesystem path' });
            }

            // High: console.log in production code (should use console.error for plugin output)
            if (/\bconsole\.log\b/.test(line) && !line.includes('//')) {
              findings.push({ severity: 'medium', file: relPath, line: lineNum, rule: 'console-log', detail: 'console.log used — prefer console.error for plugin output' });
            }

            // High: TODO/FIXME
            if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line) && !line.includes('disable')) {
              findings.push({ severity: 'medium', file: relPath, line: lineNum, rule: 'todo-placeholder', detail: 'Unresolved TODO/FIXME comment' });
            }

            // Medium: stub return
            if (/return\s+(['"][^'"]*['"]|true|false|\d+)\s*;\s*(\/\/|$)/.test(line) && /stub|todo|placeholder|fixme/i.test(lines[Math.min(i + 1, lines.length - 1)])) {
              findings.push({ severity: 'high', file: relPath, line: lineNum, rule: 'stub-return', detail: 'Possible stub return value' });
            }
          }
        } catch (e) { mantaError('code-audit: scanFile failed:', e); }
      }

      function scanDir(dir: string, depth: number = 0) {
        if (depth > 5) return;
        try {
          for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
              scanDir(full, depth + 1);
            } else if (stat.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry)) {
              scanFile(full);
            }
          }
        } catch (e) { mantaError('code-audit: scanDir failed:', e); }
      }

      scanDir(targetDir);

      const critical = findings.filter((f: { severity: string }) => f.severity === 'critical').length;
      const high = findings.filter((f: { severity: string }) => f.severity === 'high').length;
      const medium = findings.filter((f: { severity: string }) => f.severity === 'medium').length;
      const low = findings.filter((f: { severity: string }) => f.severity === 'low').length;

      const passed = critical === 0 && high === 0;

      const result = {
        status: passed ? 'passed' : 'failed',
        passed,
        critical,
        high,
        medium,
        low,
        total: findings.length,
        findings: findings.slice(0, 50),
        timestamp: new Date().toISOString(),
      };

      // Write result
      try {
        const deliveryDir = path.join(safeBase, 'evidence', 'delivery');
        fs.mkdirSync(deliveryDir, { recursive: true });
        fs.writeFileSync(path.join(deliveryDir, 'CodeAuditResult.json'), JSON.stringify(result, null, 2));
      } catch (e) {
        mantaError('Failed to write code audit result:', e);
      }

      return result;
    },
  });
}
