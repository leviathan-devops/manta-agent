# MANTA v2.2.2 — Triangle Architecture Build Spec

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
- src/index.ts — Plugin entry, register 3 agents via MANTA_AGENTS_CONFIG (agents/definitions.ts)
- src/agents/definitions.ts — Single source of truth for 3 agent definitions (names, tools, colors)
- src/manta/brains.ts — 3 T1 operational prompts (ORCHESTRATOR_T1, PLAN_BRAIN_T1, EXECUTION_BRAIN_T1) injected per-agent by system-transform-hook.ts
- src/manta/coordinator.ts — Brain switching coordinator with gate-advance callbacks
- src/hooks/v4.1/guardian-hook.ts — L0-L4 tool enforcement per agent (tool allowlist + foreign tool blocking)
- src/hooks/v4.1/system-transform-hook.ts — Identity header + T1 prompts + T1 warheads + worker scope injection via system.transform
- src/hooks/v4.1/session-hook.ts — Session lifecycle: create/end, agent tracking, directory initialization
- src/hooks/v4.1/gate-hook.ts — Auto-advance 7-gate chain via tool.execute.after evidence collection
- src/hooks/v4.1/messages-transform-hook.ts — Output-side identity derailment detection (session-agnostic)
- src/hooks/v4.1/compacting-hook.ts — Context survival injection on compaction
- src/shared/manta-identity-header.ts — Static identity header string (formatMantaIdentityHeader)
- src/shared/manta-identity-loader.ts — T2 markdown file loader (7 identity files)
- src/shared/manta-identity-synthesizer.ts — T1 warhead synthesis from T2 files (6 static warheads)
- src/shared/compaction-manager.ts — 9-doc context survival system with export cap
- src/shared/manta-logger.ts — Silent file logger (replaces console calls)
- .manta/compaction-survival/ — 5 memory anchor docs + SoC_PRESERVATION.md
- .manta/context/ — Cross-spawn state storage + messenger handoff log

### Build Steps
1. Register 3 agents with distinct tool whitelists
2. Rewrite T1 prompts (PLAN_BRAIN gets PSM by default, EXEC_BRAIN gets "stuck→signal" instruction)
3. Rewrite guardian hook for per-agent tool enforcement
4. Set up .manta/context/ for cross-spawn persistence
5. Build, typecheck, container test, ship
