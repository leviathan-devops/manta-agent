# MANTA v2.2 — Triangle Architecture Build Spec

## Architecture
Triangle: MANTA Orchestrator → PLAN_BRAIN subagent → EXECUTION_BRAIN subagent

### Three Agents
1. **MANTA** (primary, orchestrator) — Tools: task, manta-compaction, checkpoint, manta-status, manta-gate, manta-evidence only
2. **PLAN_BRAIN** (subagent, hidden) — Read-only + PSM + Hive + Vision. edit: DENY, bash: DENY
3. **EXECUTION_BRAIN** (subagent, hidden) — Full dev + container + audit. NO task tool

### Source Consolidation
- Base: `/Shared Workspace Context/Kraken Agent/Active Projects/Trident Enhanced Manta`
- Additions from: `/Shared Workspace Context/Kraken Agent/Active Projects/MANTA_V2.2`
- Identity files, compaction manager, extra tools (vision, hive, runtime-audit, trident-audit, compaction, code-review, spawn-container, test-runner)
- PSM module from Trident Enhanced

### Key Files
- src/index.ts — Plugin entry, register 3 agents with distinct tool permissions
- src/agents/ — Agent definitions
- src/manta/brains.ts — 3 sets of T1 prompts (orchestrator, plan, exec)
- src/hooks/v4.1/guardian-hook.ts — Tool blocking per agent
- src/hooks/v4.1/system-transform-hook.ts — Identity injection per agent
- src/hooks/v4.1/session-hook.ts — Context restoration
- src/shared/compaction-manager.ts — Context survival
- .manta/context/ — Cross-spawn state storage

### Build Steps
1. Register 3 agents with distinct tool whitelists
2. Rewrite T1 prompts (PLAN_BRAIN gets PSM by default, EXEC_BRAIN gets "stuck→signal" instruction)
3. Rewrite guardian hook for per-agent tool enforcement
4. Set up .manta/context/ for cross-spawn persistence
5. Build, typecheck, container test, ship
