# QUALITY.md — Manta v2.2 Quality Standards

## Non-Negotiable Standards

| Standard | Threshold | Verification |
|----------|-----------|--------------|
| Container test pass rate | ≥ 96% | manta-test-runner |
| Runtime audit | All 8 checks pass | manta-runtime-audit |
| Code review score | 0 blocking issues | manta-code-review |
| Code audit | 0 critical, 0 high | manta-code-audit |
| Evidence freshness | ≤ 24 hours | timestamp check |
| PSM completion | All 6 layers | iteration artifacts |

## Runtime-Grade Definition

Code is runtime-grade when:
1. Container TUI test passed with real LLM agent (not --print-logs)
2. All hooks verified firing at runtime
3. Identity verified ("who are you" returns correct response)
4. No theatrical code (no stubs, fakes, mocks, placeholders)
5. No silent failures (every catch logs or propagates)
6. No unchecked type assertions
7. Error paths traced in ALL code paths
8. State survives compaction

## Theatrical Test Detection

The runtime auditor blocks:
- ContainerTestResult.json with theatrical patterns
- Evidence older than 24 hours
- Missing TUI capture evidence
- Tests that pass without real LLM agent calls
- Mock/stub data in evidence files

## Anti-Derailment

| Pattern | Category | Response |
|---------|----------|----------|
| "I'll just do this quickly" | Self-implementation | BLOCK — spawn subagent |
| "This looks correct" | Premature declaration | BLOCK — raw evidence required |
| "The grep shows it works" | Source inspection | BLOCK — container test required |
| "Let me test locally" | Host fallback | BLOCK — container only |
| "100% working" | Evidence-less claim | BLOCK — provide raw output |
| "This is overkill" | Simplification | BLOCK — do the full protocol |

---

*Manta v2.2 — Quality Standards*
