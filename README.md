# Manta Agent v1.3.5

**Version:** 1.3.5  
**Status:** Production Ready  
**Architecture:** Dual-brain sequential (Plan ↔ Build) with mechanical Coordinator

---

## Overview

Manta Agent is an OpenCode plugin that provides dual-brain sequential coordination. It uses a mechanical Coordinator to switch between Plan Brain and Build Brain based on gate transitions.

## Architecture

### Core Components

```
src/
├── index.ts                 # Plugin entry point, exports hooks and tools
├── hooks/v4.1/
│   ├── index.ts             # Hook factory (creates all hooks)
│   ├── session-hook.ts     # Session lifecycle (ONLY manta agents)
│   ├── gate-hook.ts        # Tool execution aftermath + gate advancement
│   ├── guardian-hook.ts    # Zone-based protection
│   ├── system-transform-hook.ts  # Context injection + brain switching
│   ├── compacting-hook.ts  # Session compaction handling
│   └── utils.ts            # Command/path extraction utilities
├── shared/
│   ├── agent-identity.ts   # isMantaAgent(), isVanillaAgent()
│   ├── gates.ts            # GateManager (PLAN→BUILD→TEST→VERIFY→AUDIT→DELIVERY)
│   ├── evidence.ts         # EvidenceCollector
│   ├── state-store.ts      # StateStore
│   ├── messenger.ts        # BrainMessenger (handoff messaging)
│   └── guardian.ts         # Guardian (zone-based protection)
├── manta/
│   ├── brains.ts           # PLAN_BRAIN_T1, BUILD_BRAIN_T1, COORDINATOR_T1
│   └── coordinator.ts      # MantaCoordinator (brain switching)
└── tools/
    ├── manta-status.ts     # Status tool
    ├── manta-gate.ts       # Gate tool
    ├── manta-evidence.ts   # Evidence tool
    └── checkpoint.ts       # Checkpoint tool
```

### Gate Chain

```
PLAN → BUILD → TEST → VERIFY → AUDIT → DELIVERY
```

- **PLAN**: Requirements defined, SPEC.md generated
- **BUILD**: Files created per spec
- **TEST**: Tests pass, coverage ≥ 80%
- **VERIFY**: SPEC alignment, integration tests, edge cases
- **AUDIT**: SAST clean, no secrets, dependencies audited
- **DELIVERY**: Checkpoint created, evidence archived

### Dual-Brain System

Manta uses two brains:

1. **Plan Brain** - Handles SPEC.md generation, scope definition
2. **Build Brain** - Handles implementation, file creation

Coordinator mechanically switches brains:
- PLAN→BUILD transition: `coordinator.onSpecComplete()` → switch to Build Brain
- BUILD→TEST transition: `coordinator.onBuildComplete()` → switch to Plan Brain for review

## Agent Identity Filtering

**CRITICAL:** Manta hooks ONLY process manta agent sessions. Other agents (vanilla, shark, etc.) are completely bypassed.

```typescript
// gate-hook.ts
if (!isMantaAgent(agent)) {
  return;  // Skip for non-manta agents
}
```

### Identity Check

- `isMantaAgent('manta')` → true
- `isMantaAgent('manta_coder')` → true (prefix matching)
- `isMantaAgent('build')` → false (vanilla)
- `isMantaAgent('shark')` → false (other plugin)

## Key Fix in v1.3.5

### Problem
Manta hooks were processing tool results from ALL agents, causing:
- State corruption
- Premature gate advancement
- Agent "freezing" mid-execution

### Solution
Added `isMantaAgent(agent)` check to gate-hook at line 30:

```typescript
// gate-hook.ts
const { tool, sessionID, agent } = input;

// CRITICAL: Only process manta agent sessions
if (!isMantaAgent(agent)) {
  return;  // Skip for non-manta agents
}
```

## Installation

### Plugin Path
```
file:///home/leviathan/OPENCODE_WORKSPACE/Shared Workspace Context/Manta Agent/manta-agent/dist
```

### OpenCode Config
```json
{
  "plugin": [
    "...",
    "file:///home/leviathan/OPENCODE_WORKSPACE/Shared Workspace Context/Manta Agent/manta-agent/dist",
    "..."
  ],
  "agent": {
    "manta": {
      "color": "#6B4C9A"
    }
  }
}
```

## Build

```bash
cd projects/manta-agent
npm run build
```

Output: `dist/index.js` (~553 KB)

## Git Repository

- **URL:** https://github.com/leviathan-devops/manta-agent
- **Version:** v1.3.5
- **Status:** Production Ready
- **Protected:** Yes (branch protection enabled)

## Coordinator System

The Coordinator controls brain switching:

```typescript
// coordinator.ts
onSpecComplete()   // PLAN→BUILD: Switch to Build Brain
onBuildComplete()  // BUILD→TEST: Switch to Plan Brain for review
```

### State Transitions

```
Session Start → Plan Brain Active
    ↓
SPEC Complete → Build Brain Active
    ↓
Build Complete → Plan Brain Active (review mode)
    ↓
...
```

## Guardian System

Manta Guardian provides zone-based protection:

- **SANDBOX mode** (default): Personal and System zones blocked
- **STRICT mode**: Only WORKSPACE and SANDBOX zones allowed

## Evidence System

Evidence collected per gate:
- PLAN: SPEC.md, GuardianConfig.json
- BUILD: FileManifest.json, GitDiff.txt
- TEST: TestResults.xml, CoverageReport.json
- VERIFY: VerificationReport.json
- AUDIT: SASTReport.json, SecretsScan.json, AuditReport.json
- DELIVERY: EvidenceArchive.zip, DeliverySummary.md

## Debugging

### Check Gate Status
```bash
# Use manta-status tool
manta-status gate=verify
```

### Check Session State
```bash
cat .manta/sessions/{sessionId}/gate-state.json
```

### Check Evidence
```bash
ls -la .manta/evidence/{gate}/
```

## Known Issues (Resolved)

1. **Agent freezing after 1-2 minutes** - Fixed in v1.3.5 by adding isMantaAgent() filtering
2. **Cross-agent state corruption** - Fixed by proper agent identity checks

## Changelog

### v1.3.5 (Current)
- Added `isMantaAgent(agent)` check to gate-hook.ts
- Fixed cross-agent state corruption
- Color updated to #6B4C9A (lighter midnight purple)

### v1.3.4
- Initial working dual-brain coordination
- Full gate chain implementation

### v1.0.0
- Initial release
