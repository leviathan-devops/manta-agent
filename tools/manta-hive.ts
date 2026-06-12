import { tool } from '@opencode-ai/plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HIVE_BASE = path.join(process.env.HOME || '/root', '.local', 'share', 'opencode', 'hive-mind');

function toResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function createMantaHiveTool() {
  return tool({
    description: 'Read-only Hive Mind access. Search known patterns, failures, and decisions. Actions: search, read, list.',
    args: {
      action: tool.schema.string().describe('Action: search, read, or list'),
      query: tool.schema.string().optional().describe('Search query'),
      topic: tool.schema.string().optional().describe('Topic to read'),
    },
    execute: async (args: { action: string; query?: string; topic?: string }) => {
      if (!fs.existsSync(HIVE_BASE)) {
        return toResult({ status: 'not-found', message: `Hive not found at ${HIVE_BASE}`, entries: [] });
      }

      switch (args.action) {
        case 'list': {
          const topics = fs.readdirSync(HIVE_BASE)
            .filter((f: string) => fs.statSync(path.join(HIVE_BASE, f)).isDirectory() || f.endsWith('.md'));
          return toResult({ status: 'ok', topics, count: topics.length });
        }

        case 'search': {
          if (!args.query) return toResult({ status: 'error', message: 'query required for search' });
          const results: Array<{ file: string; line: number; snippet: string }> = [];
          const queryLower = args.query.toLowerCase();

          function searchDir(dir: string, depth: number = 0) {
            if (depth > 3) return;
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
              const full = path.join(dir, entry);
              const stat = fs.statSync(full);
              if (stat.isDirectory()) {
                searchDir(full, depth + 1);
              } else if (entry.endsWith('.md')) {
                const content = fs.readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].toLowerCase().includes(queryLower)) {
                    results.push({ file: path.relative(HIVE_BASE, full), line: i + 1, snippet: lines[i].slice(0, 200) });
                    if (results.length >= 20) return;
                  }
                }
              }
            }
          }

          searchDir(HIVE_BASE);
          return toResult({ status: 'ok', query: args.query, results, count: results.length });
        }

        case 'read': {
          if (!args.topic) return toResult({ status: 'error', message: 'topic required for read' });
          const topicPath = path.join(HIVE_BASE, args.topic);
          if (fs.existsSync(topicPath) && fs.statSync(topicPath).isDirectory()) {
            const files = fs.readdirSync(topicPath).filter((f: string) => f.endsWith('.md'));
            const contents: Record<string, string> = {};
            for (const f of files.slice(0, 10)) {
              contents[f] = fs.readFileSync(path.join(topicPath, f), 'utf-8');
            }
            return toResult({ status: 'ok', topic: args.topic, files: Object.keys(contents), contents });
          }
          const filePath = topicPath.endsWith('.md') ? topicPath : `${topicPath}.md`;
          if (fs.existsSync(filePath)) {
            return toResult({ status: 'ok', topic: args.topic, content: fs.readFileSync(filePath, 'utf-8') });
          }
          return toResult({ status: 'not-found', topic: args.topic });
        }

        default:
          return toResult({ status: 'error', message: `Unknown action: ${args.action}` });
      }
    },
  });
}
