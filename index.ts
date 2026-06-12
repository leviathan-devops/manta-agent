import type { Plugin, PluginInput, Hooks } from '@opencode-ai/plugin';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createStateStore } from './shared/state-store.js';
import { createMantaMessenger } from './shared/messenger.js';
import { Guardian } from './shared/guardian.js';
import { GateManager } from './shared/gates.js';
import { EvidenceCollector } from './shared/evidence.js';
import { MantaCoordinator } from './manta/coordinator.js';
import { mantaLog, mantaWarn } from './shared/manta-logger.js';

import { CompactionManager } from './shared/compaction-manager.js';
import { createMantaHooks } from './hooks/v4.1/index.js';
import { createProblemSolvingMode } from './problem-solving/problem-solving-mode.js';
import { createMantaStatusTool } from './tools/manta-status.js';
import { createMantaGateTool } from './tools/manta-gate.js';
import { createMantaEvidenceTool } from './tools/manta-evidence.js';
import { createCheckpointTool } from './tools/checkpoint.js';
import { createMantaSpawnContainerTool } from './tools/manta-spawn-container.js';
import { createMantaTestRunnerTool } from './tools/manta-test-runner.js';
import { createMantaCodeReviewTool } from './tools/manta-code-review.js';
import { createMantaHiveTool } from './tools/manta-hive.js';
import { createMantaRuntimeAuditTool } from './tools/manta-runtime-audit.js';
import { createMantaCodeAuditTool } from './tools/manta-code-audit.js';
import { createMantaVisionTool } from './tools/manta-vision.js';
import { createMantaCompactionTool } from './tools/manta-compaction.js';
import { setPluginDirectory, loadMantaIdentity, formatIdentityForSystemPrompt } from './shared/manta-identity-loader.js';
import { synthesizeT1Injectables } from './shared/manta-identity-synthesizer.js';

const mantaColor = '#6B4C9A';

export default async function MantaAgent(input: PluginInput): Promise<Hooks> {
  const { directory } = input;
  const workspacePath = process.cwd();
  const mantaDir = path.join(workspacePath, '.manta');
  fs.mkdirSync(mantaDir, { recursive: true });
  fs.mkdirSync(path.join(mantaDir, 'context'), { recursive: true });
  fs.mkdirSync(path.join(mantaDir, 'evidence', 'delivery'), { recursive: true });
  const stateStore = createStateStore();
  const messenger = createMantaMessenger();
  const guardian = new Guardian({ level: 'SANDBOX' });
  const gm = new GateManager(mantaDir);
  const ec = new EvidenceCollector(mantaDir);
  const coordinator = new MantaCoordinator({ stateStore, messenger, gateManager: gm });
  const psm = createProblemSolvingMode(workspacePath);
  const compactionManager = new CompactionManager(workspacePath);
  coordinator.initialize();

  // Initialize identity pipeline
  try {
    const pluginDir = import.meta?.url ? new URL('.', import.meta.url).pathname : process.cwd();
    setPluginDirectory(pluginDir);
    const identity = loadMantaIdentity();
    if (identity) {
      synthesizeT1Injectables();
      mantaLog('Identity pipeline initialized: 7 T2 files → 6 T1 warheads');
    } else {
      mantaWarn('Identity files not found — running without T2 identity pipeline');
    }
  } catch (e) {
    mantaWarn('Identity pipeline init failed (non-fatal):', e);
  }

  const statusTool = createMantaStatusTool(stateStore, gm);
  const gateTool = createMantaGateTool(gm, guardian);
  const evidenceTool = createMantaEvidenceTool(ec);
  const checkpointTool = createCheckpointTool(stateStore, gm);
  const spawnContainerTool = createMantaSpawnContainerTool();
  const testRunnerTool = createMantaTestRunnerTool();
  const codeReviewTool = createMantaCodeReviewTool(psm.brain);
  const hiveTool = createMantaHiveTool();
  const runtimeAuditTool = createMantaRuntimeAuditTool(mantaDir);
  const codeAuditTool = createMantaCodeAuditTool(mantaDir);
  const visionTool = createMantaVisionTool();
  const compactionTool = createMantaCompactionTool(compactionManager, gm);
  const hooks = createMantaHooks(guardian, gm, ec, coordinator as any, stateStore, messenger, psm.brain, undefined, compactionManager);
  return {
    ...hooks,
    tool: {
      'manta-status': statusTool as any,
      'manta-gate': gateTool as any,
      'manta-evidence': evidenceTool as any,
      'checkpoint': checkpointTool as any,
      'manta-spawn-container': spawnContainerTool as any,
      'manta-test-runner': testRunnerTool as any,
      'manta-code-review': codeReviewTool as any,
      'manta-hive': hiveTool as any,
      'manta-runtime-audit': runtimeAuditTool as any,
      'manta-code-audit': codeAuditTool as any,
      'manta-vision': visionTool as any,
      'manta-compaction': compactionTool as any,
      ...psm.tools as any,
    },
    config: async (cfg: Record<string, unknown>) => {
      if (!cfg.agent) cfg.agent = {};
      const agent = cfg.agent as Record<string, Record<string, unknown>>;
      agent['manta'] = {
        name: 'manta', description: 'MANTA v2.2.2 — Orchestrator. Spawns Plan/Execution brains.',
        instructions: 'MANTA v2.2.2 orchestrator — identity via system.transform. Use task(agent=manta-plan) for analysis, task(agent=manta-exec) for implementation.',
        mode: 'primary', color: mantaColor,
        tools: { 'task': true, 'manta-compaction': true, 'checkpoint': true, 'manta-status': true, 'manta-gate': true, 'manta-evidence': true, 'todowrite': true },
      };
      agent['manta-plan'] = {
        name: 'manta-plan', description: 'MANTA Plan Brain — Read-only analysis with PSM.',
        instructions: 'MANTA v2.2.2 plan brain — read-only analysis. Use PSM for problem solving. Return JSON.',
        mode: 'subagent', hidden: true, color: mantaColor,
        tools: { 'read': true, 'glob': true, 'grep': true, 'webfetch': true, 'question': true, 'manta-hive': true, 'manta-vision': true, 'manta-code-review': true, 'checkpoint': true, 'ps-mode-status': true, 'ps-mode-layer': true, 'ps-mode-evidence': true, 'ps-mode-derail': true, 'ps-mode-debug': true },
      };
      agent['manta-exec'] = {
        name: 'manta-exec', description: 'MANTA Execution Brain — Full dev implementation.',
        instructions: 'MANTA v2.2.2 exec brain — implement from plan. If stuck: EXECUTION_STUCK.',
        mode: 'subagent', hidden: true, color: mantaColor,
        tools: { 'read': true, 'write': true, 'edit': true, 'bash': true, 'glob': true, 'grep': true, 'manta-spawn-container': true, 'manta-test-runner': true, 'manta-runtime-audit': true, 'manta-code-audit': true, 'manta-code-review': true, 'manta-vision': true, 'checkpoint': true },
      };
    },
  };
}
