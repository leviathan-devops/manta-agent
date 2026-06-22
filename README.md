# MANTA v2.2.2 — Dual-Brain Sequential Precision Engineering Agent

**MANTA** (Main Agent Never Touches Anything) is a dual-brain sequential precision engineering agent built on the opencode plugin system. It implements a **Triangle Architecture**: an orchestrator delegates to a read-only Plan Brain for analysis and a full-access Execution Brain for implementation, with mechanical enforcement through guardian tool allowlists, a 7-stage gate pipeline, and container-runtime verification.

```
                    ┌─────────────────────────────────────┐
                    │         MANTA v2.2.2                 │
                    │         (Orchestrator)               │
                    │  task, gate, status, evidence,       │
                    │  compaction, checkpoint,             │
                    │  visual-cortex_* (34),               │
                    │  reasoning-bus_* (6), hive_* (9)     │
                    │                                      │
                    │  ┌─────────────────────────────────┐ │
                    │  │    7-STAGE GATE PIPELINE         │ │
                    │  │ PLAN→BUILD→REVIEW→VERIFY→       │ │
                    │  │ TEST→AUDIT→DELIVERY              │ │
                    │  │ Sequential. No skipping.         │ │
                    │  │ 3-attempt verify loop, then      │ │
                    │  │ escalate with iteration bump.    │ │
                    │  └─────────────────────────────────┘ │
                    └──────────┬──────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
   ┌─────────────────────────┐  ┌─────────────────────────┐
   │      manta-plan         │  │      manta-exec          │
   │     (Plan Brain)        │  │     (Exec Brain)         │
   │  Read-only + PSM        │  │  Write + execution +     │
   │  NO write/edit/bash/task│  │  full filesystem access  │
   │  + VC(34), RB(6)        │  │  + VC(34), RB(6)         │
   │  Analysis, planning,    │  │  Implementation, build,  │
   │  code review, research  │  │  test, container, audit  │
   └─────────────────────────┘  └─────────────────────────┘
```

---

## Architecture

### Triangle Architecture

MANTA operates three agents with strictly enforced tool boundaries:

| Agent | Mode | Tools | Role |
|-------|------|-------|------|
| **manta** (Orchestrator) | primary | task, manta-compaction, checkpoint, manta-status, manta-gate, manta-evidence, visual-cortex_* (34 tools), reasoning-bus_* (6 tools), hive_* (9 tools) | Spawns subagents, tracks gates, manages state, vision, reasoning bus, hive mind |
| **manta-plan** (Plan Brain) | subagent, hidden | read, glob, grep, webfetch, hive_* (5 read-only), manta-code-review, checkpoint, ps-mode-*, visual-cortex_* (34 tools), reasoning-bus_* (6 tools) | Analysis, planning, PSM layer progression, code review |
| **manta-exec** (Exec Brain) | subagent, hidden | read, write, edit, bash, glob, grep, manta-spawn-container, manta-test-runner, manta-runtime-audit, manta-code-audit, manta-code-review, checkpoint, visual-cortex_* (34 tools), reasoning-bus_* (6 tools) | Write execution fully — implementation, build, test, container ops, audit |

### Platform Tool Categories

MANTA v2.2.2 integrates three platform-level tool families, accessible to all agents:

| Category | Count | Access | Description |
|----------|-------|--------|-------------|
| **Visual Cortex** (`visual-cortex_*`) | 34 tools | FULL for all agents | VLM vision, browser automation (CDP), screenshots, TradingView chart ops, SemInt monitoring, tile management |
| **Reasoning Bus** (`reasoning-bus_*`) | 6 tools | FULL for all agents | Inter-agent messaging: channels, threads, proposals, concerns, decisions, resolutions |
| **Hive Mind** (`hive_*`) | 9 tools (orch.), 5 read-only (subagents) | Tiered | Persistent shared memory: remember, context, scan, forget, purge, restore, trash, status |

> **Note**: `manta-hive` has been removed and replaced with `hive_*` platform tools. `manta-vision` has been removed and replaced with `visual-cortex_*` MCP tools. `hive` is intentionally excluded from FOREIGN_IDENTIFIERS to allow `hive_*` tools through the firewall.

### Guardian Enforcement

Tool allowlists are enforced **mechanically** — not by model prompting — through the `guardian-hook.ts` system:

- **Per-agent allowlists**: Each agent has a hardcoded `Set<string>` of allowed tools
- **Orchestrator sandbox**: Core tools only (task, compaction, checkpoint, status, gate, evidence) + visual-cortex (34), reasoning-bus (6), hive (9) — cannot read/write files or execute bash directly
- **Plan Brain readonly**: Cannot write files, edit, run bash, or spawn containers
- **Exec Brain no task**: Cannot spawn subagents (prevents infinite delegation loops)
- **Foreign tool blocking**: All shark/kraken/spider/trident/hydra/hermes tools are blocked for manta agents
- **Hive exemption**: `hive` is intentionally NOT in FOREIGN_IDENTIFIERS, allowing `hive_*` platform tools through
- **Dangerous command guard**: `bash` commands are inspected for destructive patterns; `rm -rf` blocked at firewall L4
- **File path zone restriction**: `write`/`edit` paths validated against allowed zones
- **manta-hive removed**: Replaced with `hive_*` platform tools (hive_remember, hive_context, hive_scan, etc.)
- **manta-vision removed**: Replaced with `visual-cortex_*` MCP tools (visual-cortex_analyze, visual-cortex_browser_screenshot, etc.)

### Identity Pipeline

MANTA's identity is injected at runtime through `system-transform-hook.ts`, which:

1. Detects agent transitions (non-MANTA → MANTA) and inserts transition notes
2. Replaces opencode runtime defaults with the MANTA identity header
3. Injects 6 T1 warheads from 7 T2 identity files at system transform
4. Injects PSM mandate for manta-plan
5. Maintains a 36-cycle loop counter with status line
6. Cleans up foreign identity patterns (SHARK, KRAKEN, TRIDENT, SPIDER)

### 7-Stage Gate Pipeline

```text
PLAN → BUILD → REVIEW → VERIFY → TEST → AUDIT → DELIVERY
```

- **Sequential enforcement**: `canTransition()` prevents gate skipping
- **Verify loop**: Up to 3 retry attempts before escalation
- **Iteration escalation**: After 3 verify failures, iteration bumps (V1.0 → V1.1) and resets to PLAN
- **Evidence collection**: Each gate logs evidence to `.manta/evidence/{gate}/`

### PSM — Problem Solving Mode

6-layer structured problem-solving system:

| Layer | Focus | Description |
|-------|-------|-------------|
| 1 | Assumption | Explicit assumptions, reasoning chain, success criteria |
| 2 | Action | Exact command, expected output, environment state |
| 3 | Observation | Raw evidence, logs checked, expected vs actual |
| 4 | Gap Analysis | Gap analysis, updated hypothesis, next action |
| 5 | Pattern Extraction | What should have been done, pattern extracted, systemic issue |
| 6 | Verification | Container execution, behavior matches requirement, no regressions |

### Compaction System

State survival across context window limits:

- 5 survival docs written to `.manta/compaction-survival/`
- Anchor-based E2E storage for cross-session recovery
- Recovery protocol: read survival docs in order to restore state

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [opencode](https://github.com/anthropics/opencode) >= 1.14
- Docker (for container testing)

### Build

```bash
bun install
bun run build
```

Output: `dist/index.js` (179KB bundle) + source map.

### Run Tests

```bash
node scripts/manta-verify.js
```

146 tests covering: plugin load, 17 tool registration, 6 hooks, 3 agents, 13 identity injection tests, 45 guardian enforcement tests, loop counter, PSM progression, gate chain, compaction E2E, coordinator cycle, agent isolation toggle, stress/overload.

### Deploy

```bash
# Build the bundle
bun run build

# Add to opencode config
# In your opencode.json:
{
  "plugin": ["file:///path/to/manta-agent/dist/index.js"],
  "agent": {
    "manta": {
      "name": "manta",
      "mode": "primary",
      "tools": { "task": true, "manta-compaction": true, "checkpoint": true, "manta-status": true, "manta-gate": true, "manta-evidence": true }
    }
  }
}

# Launch
opencode --agent manta
```

### Container Test

```bash
# Build and launch in container
bun run build
docker run -d --rm --name manta-test \
  -v "$(pwd)/dist/index.js:/root/.config/opencode/plugins/manta/index.js:ro" \
  runtime-grade-container-sandbox:latest \
  /bin/sh -c 'sleep 3600'

# Connect TUI
docker exec -it manta-test /usr/local/bin/opencode --agent manta
```

---

## Project Structure

```text
manta-agent/
├── index.ts                    # Plugin entry point — agent registration, tool wiring
├── agents/
│   └── definitions.ts          # Canonical agent config (currently standalone reference)
├── manta/
│   ├── brains.ts               # 3 T1 prompts: ORCHESTRATOR, PLAN_BRAIN, EXECUTION_BRAIN
│   └── coordinator.ts          # Brain switching: Plan ↔ Build with messenger handoffs
├── hooks/v4.1/
│   ├── index.ts                # Hook registration hub
│   ├── guardian-hook.ts        # Tool allowlist enforcement + loop counter
│   ├── system-transform-hook.ts # Identity injection, PSM mandate, foreign cleanup
│   ├── session-hook.ts         # Context restoration, session lifecycle
│   ├── gate-hook.ts            # 7-gate pipeline advancement
│   ├── chat-message-hook.ts    # Identity query detection, agent tracking
│   ├── compacting-hook.ts      # Compaction survival writes
│   ├── agent-state.ts          # Current agent tracker
│   └── utils.ts                # Path/command extraction utilities
├── tools/
│   ├── manta-status.ts         # Pipeline state visibility
│   ├── manta-gate.ts           # Gate evaluation CLI
│   ├── manta-evidence.ts       # Evidence collection viewer
│   ├── checkpoint.ts           # State checkpointing
│   ├── manta-spawn-container.ts # Docker container lifecycle
│   ├── manta-test-runner.ts    # Runtime test execution
│   ├── manta-code-review.ts    # Code quality review
│   ├── manta-runtime-audit.ts  # Runtime grade audit
│   ├── manta-code-audit.ts     # Source code audit
│   └── manta-compaction.ts     # Compaction anchor management
├── problem-solving/
│   ├── psm-activator.ts        # Derailment detection (stuck loop, error repeat, etc.)
│   ├── state-machine.ts        # Layer state management
│   ├── problem-solving-brain.ts # PSM orchestration
│   ├── anti-derailment.ts      # Anti-derailment engine
│   ├── coordinator-v2.ts       # V2 coordinator with signal processing
│   ├── types.ts                # PSM type definitions
│   └── tools/                  # PSM tools (ps-mode-layer, status, evidence, derail, debug)
├── shared/
│   ├── gates.ts                # GateManager — 7-gate chain with deadlock protocol
│   ├── evidence.ts             # EvidenceCollector — per-gate evidence storage
│   ├── guardian.ts             # Guardian — dangerous command/file path validation
│   ├── state-store.ts          # Key-value state persistence
│   ├── messenger.ts            # Brain-to-brain messaging with priority queuing
│   ├── compaction-manager.ts   # Context survival with 5-doc system
│   ├── agent-identity.ts       # Agent identity check functions
│   ├── manta-identity-loader.ts # T2 identity file loader
│   ├── manta-identity-synthesizer.ts # T1 warhead synthesis
│   └── manta-identity-header.ts # Static identity header generator
├── identity/manta/             # 7 T2 identity files (CORE, IDENTITY, EXECUTION, etc.)
├── dist/
│   ├── index.js                # Built plugin bundle (179KB)
│   └── index.js.map            # Source map
├── scripts/
│   └── manta-verify.js         # 146-test verification suite
├── .manta/                     # Runtime state directory
│   ├── compaction-survival/    # 5 survival docs
│   └── evidence/              # Gate evidence
├── package.json
├── opencode.json               # Deployment config template
├── SPEC.md                     # Architecture specification
└── README.md                   # This file
```

---

## Quality Enforcement Gates

### Mechanical Enforcement (Non-Negotiable)

| System | Mechanism | Scope |
|--------|-----------|-------|
| Tool Allowlists | `Set<string>` per agent in guardian-hook.ts | 45 enforcement points verified |
| Foreign Tool Blocking | Prefix matching against known agent identifiers | 7 foreign agents blocked |
| Loop Counter | 36-cycle hard limit on task tool | Persisted to disk |
| Gate Chain | Sequential advancement only, no skipping | 7 gates |
| Verify Loop | 3-attempt max before escalation to PLAN | Auto-iteration bump |
| Evidence Collection | Per-gate timestamped evidence files | Validates all gates complete |

### Identity Enforcement

| System | Mechanism | Scope |
|--------|-----------|-------|
| Runtime Default Replacement | Replaces opencode boilerplate with MANTA identity | Every system transform |
| Agent Transition Detection | Insert transition notes between agents | All non-MANTA → MANTA transitions |
| Foreign Identity Cleanup | Remove non-MANTA identity patterns from system prompt | SHARK, KRAKEN, TRIDENT, SPIDER |
| PSM Mandate | Mandate injection for manta-plan | Every manta-plan transform |

### Runtime Verification

| Check | Method | Standard |
|-------|--------|----------|
| tsc | `npx tsc --noEmit` | 0 errors |
| Build | `bun run build` | Clean, 179KB bundle |
| Unit Tests | `node scripts/manta-verify.js` | 146/146 pass (100%) |
| Container Test | Runtime structural verification | 6/6 pass (100%) |
| Stress Test | 100 transforms, 1000 guardian, 100 loop writes | 0 failures |

---

## Version History

| Version | Branch | Status |
|---------|--------|--------|
| v2.2.2 | `main` | **SHIPPED** — Current release, A+ remediation complete |
| v1.3.5 | `legacy-v1.3.5` | Legacy — Previous architecture |

## License

MIT — See package.json for details.
