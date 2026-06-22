/**
 * Agent definitions for triangle architecture
 */
export const MANTA_AGENTS_CONFIG = {
  orchestrator: {
    name: 'manta',
    description: 'MANTA v2.2 — Orchestrator. Spawns Plan Brain and Execution Brain subagents.',
    mode: 'primary' as const,
    color: '#6B4C9A',
    tools: ['task', 'manta-compaction', 'checkpoint', 'manta-status', 'manta-gate', 'manta-evidence', 'todowrite', 'visual-cortex_*', 'hive_context', 'hive_scan', 'hive_status', 'hive_trash_list', 'hive_trash_status', 'hive_remember', 'hive_forget', 'hive_purge', 'hive_restore', 'reasoning-bus_*'],
  },
  planBrain: {
    name: 'manta-plan',
    description: 'MANTA Plan Brain — Read-only analysis with PSM. Cannot write code.',
    mode: 'subagent' as const,
    hidden: true,
    color: '#6B4C9A',
    tools: ['read', 'glob', 'grep', 'webfetch', 'question',
            'hive_context', 'hive_scan', 'hive_status', 'hive_trash_list', 'hive_trash_status', 'manta-code-review', 'checkpoint',
            'ps-mode-status', 'ps-mode-layer', 'ps-mode-evidence', 'ps-mode-derail', 'ps-mode-debug',
            'visual-cortex_*', 'reasoning-bus_*'],
  },
  execBrain: {
    name: 'manta-exec',
    description: 'MANTA Execution Brain — Full dev access. Executes SPEC.md precisely.',
    mode: 'subagent' as const,
    hidden: true,
    color: '#6B4C9A',
    tools: ['read', 'write', 'edit', 'bash', 'glob', 'grep',
            'manta-spawn-container', 'manta-test-runner',
            'manta-runtime-audit', 'manta-code-audit',
            'manta-code-review', 'checkpoint',
            'visual-cortex_*', 'reasoning-bus_*'],
  },
} as const;
