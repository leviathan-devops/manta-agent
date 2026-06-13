/**
 * Agent definitions for triangle architecture
 */
export const MANTA_AGENTS_CONFIG = {
  orchestrator: {
    name: 'manta',
    description: 'MANTA v2.2 — Orchestrator. Spawns Plan Brain and Execution Brain subagents.',
    mode: 'primary' as const,
    color: '#6B4C9A',
    tools: ['task', 'manta-compaction', 'checkpoint', 'manta-status', 'manta-gate', 'manta-evidence'],
  },
  planBrain: {
    name: 'manta-plan',
    description: 'MANTA Plan Brain — Read-only analysis with PSM. Cannot write code.',
    mode: 'subagent' as const,
    hidden: true,
    color: '#6B4C9A',
    tools: ['read', 'glob', 'grep', 'webfetch', 'question',
            'manta-hive', 'manta-vision', 'manta-code-review', 'checkpoint',
            'ps-mode-status', 'ps-mode-layer', 'ps-mode-evidence', 'ps-mode-derail', 'ps-mode-debug'],
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
            'manta-code-review', 'manta-vision', 'checkpoint'],
  },
} as const;
