# TOOLS.md — Manta v2.2 Tool Contract

## Core Tools (4)

| Tool | Purpose |
|------|---------|
| `manta-status` | Show current brain, gate, iteration, PSM state |
| `manta-gate` | Evaluate gate, get criteria, advance |
| `manta-evidence` | View evidence collection status |
| `checkpoint` | Create state snapshot for recovery |

## Container Tools (3)

| Tool | Purpose |
|------|---------|
| `manta-spawn-container` | Spawn sandboxed Docker container (<5s) |
| `manta-test-runner` | Run 11-test mechanical suite in container |
| `manta-code-review` | Code review for REVIEW/VERIFY gates |

## Audit Tools (3)

| Tool | Purpose |
|------|---------|
| `manta-code-audit` | Code audit for AUDIT gate |
| `manta-vision` | VLM-powered image/vision analysis |
| `manta-runtime-audit` | Runtime-grade verification for AUDIT gate |

## Vision Tool (1)

| Tool | Purpose |
|------|---------|
| `manta-vision` | Read screenshots, images, UI errors via VLM-4.6V-Flash |

## Compaction Tool (1)

| Tool | Purpose |
|------|---------|
| `manta-compaction` | Token budget status, manual state export for compaction survival |

## PSM Tools (5)

| Tool | Purpose |
|------|---------|
| `ps-mode-status` | Show current PSM layer + iteration |
| `ps-mode-layer` | Submit/check layer, advance pipeline |
| `ps-mode-evidence` | Validate evidence source |
| `ps-mode-derail` | Check text for derailment patterns |
| `ps-mode-debug` | View/save debug log entries |

## Subagent Types

- `explore` — Fast codebase exploration
- `general` — Multi-step research tasks

## Tool Isolation

Manta agents may ONLY use tools listed above.
Cross-agent tools (shark-*, kraken-*, trident-*) are BLOCKED.

---

*Manta v2.2 — Tool Contract*
