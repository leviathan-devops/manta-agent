import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mantaError } from './manta-logger.js';

const IDENTITY_FILES = ['MANTA.md', 'IDENTITY.md', 'EXECUTION.md', 'QUALITY.md', 'TOOLS.md', 'FIREWALL_CONTEXT.md', 'WORKFLOW.md', 'ARCHITECTURE.md'];

let pluginDir: string | null = null;
let cachedIdentity: MantaIdentity | null = null;
let cachedPrompt: string | null = null;

export interface MantaIdentity {
  MANTA: string;
  IDENTITY: string;
  EXECUTION: string;
  QUALITY: string;
  TOOLS: string;
  FIREWALL_CONTEXT: string;
  WORKFLOW: string;
  ARCHITECTURE: string;
}

export function setPluginDirectory(dir: string): void {
  pluginDir = dir;
  resetIdentityCache();
}

export function getSearchPaths(): string[] {
  const paths: string[] = [];
  if (pluginDir) {
    paths.push(path.join(pluginDir, 'identity', 'manta'));
    paths.push(path.join(pluginDir, '..', 'identity', 'manta'));
  }
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  paths.push(path.join(dirname, '..', 'identity', 'manta'));
  paths.push(path.join(dirname, '..', '..', 'identity', 'manta'));
  paths.push(path.join(process.cwd(), 'identity', 'manta'));
  paths.push(path.join(process.cwd(), '..', 'identity', 'manta'));
  paths.push(path.join(process.env.HOME || '/root', '.config', 'opencode', 'identity', 'manta'));
  return paths;
}

export function loadMantaIdentity(): MantaIdentity | null {
  if (cachedIdentity) return cachedIdentity;

  const searchPaths = getSearchPaths();
  for (const sp of searchPaths) {
    const fullPath = path.resolve(sp);
    if (fs.existsSync(fullPath)) {
      const identity: MantaIdentity = {
        MANTA: '', IDENTITY: '', EXECUTION: '', QUALITY: '',
        TOOLS: '', FIREWALL_CONTEXT: '', WORKFLOW: '', ARCHITECTURE: '',
      };
      let loadedCount = 0;
      for (const file of IDENTITY_FILES) {
        const filePath = path.join(fullPath, file);
        if (fs.existsSync(filePath)) {
          try {
            const key = file.replace('.md', '') as keyof MantaIdentity;
            identity[key] = fs.readFileSync(filePath, 'utf-8');
            loadedCount++;
          } catch (err) {
            mantaError('[MantaIdentityLoader] Error loading:', err);
          }
        }
      }
      if (loadedCount >= 6) {
        cachedIdentity = identity;
        return identity;
      }
    }
  }
  return null;
}

export function formatIdentityForSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;

  const identity = loadMantaIdentity();
  if (!identity) {
    cachedPrompt = '';
    return '';
  }

  const sections = [
    '# MANTA v2.2.2 IDENTITY — Dual-Brain Sequential Precision Engineering Agent',
    '',
    identity.MANTA,
    '',
    '## Role & Identity',
    identity.IDENTITY,
    '',
    '## Execution Patterns',
    identity.EXECUTION,
    '',
    '## Quality Standards',
    identity.QUALITY,
    '',
    '## Tool Philosophy',
    identity.TOOLS,
    '',
    '## Firewall & Guardian Context',
    identity.FIREWALL_CONTEXT,
    '',
    '## Dual-Brain Workflow',
    identity.WORKFLOW,
    '',
    '*MANTA v2.2.2 — Plan precisely. Execute exactly. Verify mechanically. Ship what works.*',
  ];

  cachedPrompt = sections.join('\n');
  return cachedPrompt;
}

export function getMantaIdentityPrompt(): string {
  return formatIdentityForSystemPrompt();
}

export function isMantaIdentityLoaded(): boolean {
  return cachedIdentity !== null;
}

export function resetIdentityCache(): void {
  cachedIdentity = null;
  cachedPrompt = null;
}
