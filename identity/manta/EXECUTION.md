# EXECUTION.md — Manta v2.2 Execution Protocol

## Gate Chain

PLAN → BUILD → REVIEW → VERIFY → TEST → AUDIT → DELIVERY

## Execution Protocol

### PLAN Gate
- Analyze task requirements
- Generate SPEC.md with acceptance criteria
- Define scope boundaries
- Activate Manta PSM if complexity > trivial

### BUILD Gate
- Execute SPEC.md exactly
- No design decisions — spec is law
- Report what was created
- Signal build-complete to Coordinator

### REVIEW Gate
- Static code analysis via manta-code-review
- Block: theatrical code, TODOs, stubs, empty catches, magic numbers
- Produce CodeReviewReport.json

### VERIFY Gate
- Spec alignment check — does implementation match SPEC.md?
- Use manta-code-review with spec comparison
- Block: any deviation from spec without documented reason

### TEST Gate
- Container TUI test via manta-test-runner
- 11-test mechanical suite
- 96%+ pass rate required
- Produce ContainerTestResult.json

### AUDIT Gate
- Runtime-grade audit via manta-runtime-audit
- Detect theatrical tests, fake evidence, stale results
- Code audit via manta-code-audit
- Block: critical or high findings

### DELIVERY Gate
- All previous gates passed
- Evidence archived
- State checkpointed

## Problem Solving Mode (Manta PSM)

When stuck, activate 6-layer pipeline:
1. **Assumption** — State explicit assumption + reasoning chain
2. **Action** — Predict exact outcome BEFORE executing
3. **Observation** — Compare expected vs actual (raw evidence)
4. **Gap Analysis** — "Expected X, got Y, therefore Z"
5. **Meta-Reflection** — Extract patterns, identify systemic issues
6. **Verification** — Container verification, 96%+ pass rate

## Iteration Loop

- VERIFY fail → BUILD → REVIEW → VERIFY (max 3 attempts)
- After 3 failures → escalate to PLAN with new iteration (V1.0 → V1.1)
- Each iteration gets full context + debug logs from previous

## Compaction Survival Protocol

When context compaction fires (OpenCode auto-triggers at ~85% tokens):

### Automatic (via session.compacting hook)
1. Full gate state exported to `.manta/compaction-survival/`
2. INJECTION.md generated with gate position + decisions + recovery steps
3. Recovery context pushed to output for post-compact resumption

### Manual (via manta-compaction tool)
- `action: "status"` — check token budget, last export, decision count
- `action: "export"` — manually trigger pre-compaction state export

### Token Budget Tiers
| Tier | Threshold | Action |
|------|-----------|--------|
| WARNING | 65% | Begin proactive cleanup, stop starting new tasks |
| PRE-COMPACTION | 75% | Export ALL state to disk, create handover package |
| IMMINENT | 85% | Auto-compaction fires — hook exports automatically |

### Post-Compaction Recovery
1. Read INJECTION.md from `.manta/compaction-survival/manta-compact-*`
2. Restore gate state from state-snapshot.json
3. Resume from last active gate
4. Continue in-flight task

---

*Manta v2.2 — Execution Protocol*
