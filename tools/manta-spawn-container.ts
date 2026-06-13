/**
 * manta-spawn-container — Spawn sandboxed container for Manta testing
 *
 * Ported from Shark v4.9 with Manta-specific naming and isolation.
 * Each project gets its OWN container named manta-{projectName}-{YYYY-MM-DD}.
 */

import { tool } from '@opencode-ai/plugin';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mantaError } from '../shared/manta-logger.js';

export interface SpawnContainerInput {
  projectName: string;
  pluginSource?: string;
  projectPath?: string;
  model?: string;
  apiKey?: string;
}

export interface SpawnContainerOutput {
  containerName: string;
  tmuxSession: string;
  snapshotPath: string;
  success: boolean;
  error?: string;
}

const MANTA_AGENT_NAME = 'manta';
const MANTA_AGENT_COLOR = '#6B4C9A';
const CONTAINER_IMAGE = 'opencode-test:1.14.34';
const RESERVED_PREFIXES = ['shark-', 'kraken-', 'trident-', 'architect-', 'opencode-'];

function safeExec(command: string, opts?: Record<string, unknown>): string {
  const sanitized = command.replace(/[^a-zA-Z0-9_\-\s/.:={}'">|&;]/g, '');
  return String(execSync(sanitized, opts as any));
}

function getDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function generateContainerName(projectName: string): string {
  const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return `manta-${safeName}-${getDateString()}`;
}

function validateIsolation(containerName: string): void {
  for (const prefix of RESERVED_PREFIXES) {
    if (containerName.startsWith(prefix)) {
      throw new Error(`[CONTAINER ISOLATION] Name "${containerName}" uses reserved prefix "${prefix}". Manta containers must start with "manta-".`);
    }
  }
}

function createSnapshot(pluginSource: string, model: string, apiKey: string): string {
  const SNAP = fs.mkdtempSync(path.join('/tmp', 'manta-snap.XXXX'));
  const configDir = path.join(SNAP, 'config');
  const pluginsDir = path.join(configDir, 'plugins', MANTA_AGENT_NAME);

  fs.mkdirSync(pluginsDir, { recursive: true });

  const indexJs = path.join(pluginSource, 'dist', 'index.js');
  if (fs.existsSync(indexJs)) {
    fs.copyFileSync(indexJs, path.join(pluginsDir, 'index.js'));
  }

  const modelConfig: Record<string, unknown> = {};
  if (model && model.includes('/')) {
    const [provider] = model.split('/');
    modelConfig.model = model;
    modelConfig.provider = {
      [provider]: { options: { apiKey } },
    };
  }

  const opencodeJson = {
    ...modelConfig,
    plugin: [`file:///root/.config/opencode/plugins/${MANTA_AGENT_NAME}/index.js`],
    agent: {
      [MANTA_AGENT_NAME]: {
        name: MANTA_AGENT_NAME,
        description: 'Trident Enhanced Manta — Problem Solving Mode',
        mode: 'primary',
        color: MANTA_AGENT_COLOR,
        tools: {
          'manta-status': true, 'manta-gate': true, 'manta-evidence': true,
          'checkpoint': true, 'manta-hive': true, 'manta-vision': true,
          'manta-compaction': true, 'manta-code-review': true,
          'manta-runtime-audit': true, 'manta-code-audit': true,
          'manta-spawn-container': true, 'manta-test-runner': true,
          'ps-mode-status': true, 'ps-mode-layer': true,
          'ps-mode-evidence': true, 'ps-mode-derail': true, 'ps-mode-debug': true,
        },
      },
    },
    permission: { '*': { '*': 'allow' } },
  };

  fs.writeFileSync(path.join(configDir, 'opencode.json'), JSON.stringify(opencodeJson, null, 2));

  return SNAP;
}

function spawnMantaContainer(input: SpawnContainerInput): SpawnContainerOutput {
  const {
    projectName,
    pluginSource = process.cwd(),
    model = 'deepseek/deepseek-v4-flash',
    apiKey = process.env.DEEPSEEK_API_KEY || '',
  } = input;

  const containerName = generateContainerName(projectName);
  const tmuxSession = `${containerName}-tui`;

  try {
    validateIsolation(containerName);
  } catch (err) {
    return { containerName, tmuxSession, snapshotPath: '', success: false, error: err instanceof Error ? err.message : String(err) };
  }

  try { safeExec(`docker rm -f ${containerName} 2>/dev/null`, { stdio: 'ignore' }); } catch (e) { mantaError('spawn: pre-cleanup docker rm failed:', e); }
  try { safeExec(`tmux kill-session -t ${tmuxSession} 2>/dev/null`, { stdio: 'ignore' }); } catch (e) { mantaError('spawn: pre-cleanup tmux kill failed:', e); }

  const SNAP = createSnapshot(pluginSource, model, apiKey);

  try {
    const dockerCmd = `docker run -d --rm --name ${containerName} --entrypoint "" -v ${SNAP}/config:/root/.config/opencode ${CONTAINER_IMAGE} /bin/sh -c 'sleep 3600'`;
    safeExec(dockerCmd, { stdio: 'pipe' });
    safeExec('sleep 5', { stdio: 'pipe' });

    const psCheck = safeExec(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`, { encoding: 'utf-8' });
    if (!psCheck.trim().includes(containerName)) {
      throw new Error('Container not running after 5s');
    }

    return { containerName, tmuxSession, snapshotPath: SNAP, success: true };
  } catch (err) {
    return { containerName, tmuxSession, snapshotPath: SNAP, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function cleanupMantaContainer(containerName: string, tmuxSession: string, snapshotPath: string): void {
  try { safeExec(`tmux kill-session -t ${tmuxSession} 2>/dev/null`, { stdio: 'ignore' }); } catch (e) { mantaError('cleanup: tmux kill failed:', e); }
  try { safeExec(`docker rm -f ${containerName} 2>/dev/null`, { stdio: 'ignore' }); } catch (e) { mantaError('cleanup: docker rm failed:', e); }
  try { fs.rmSync(snapshotPath, { recursive: true, force: true }); } catch (e) { mantaError('cleanup: snapshot rm failed:', e); }
}

export function createMantaSpawnContainerTool() {
  return tool({
    description: 'Spawn a sandboxed Docker container for Manta testing. Each project gets its OWN container named manta-{projectName}-{YYYY-MM-DD}. Uses opencode-test:1.14.34 image.',
    args: {
      projectName: tool.schema.string().describe('Project name for container naming'),
      pluginSource: tool.schema.string().optional().describe('Path to plugin source directory'),
      model: tool.schema.string().optional().describe('Model identifier'),
      apiKey: tool.schema.string().optional().describe('API key for the model'),
    },
    execute: async (input: { projectName: string; pluginSource?: string; model?: string; apiKey?: string }) => {
      const result = spawnMantaContainer(input as SpawnContainerInput);
      return JSON.stringify(result);
    },
  });
}
