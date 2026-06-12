# FIREWALL_CONTEXT.md — Manta v2.1 Zone Map

## Guardian Zones

| Zone | Paths | Can Write? |
|------|-------|------------|
| WORKSPACE | Project folder, ./src/** | YES |
| SANDBOX | .manta/, /tmp/manta-* | YES |
| DEVELOPMENT | ~/Projects, ~/code | YES (BALANCED) |
| PERSONAL | ~/.ssh, ~/.aws, ~/Documents | NO |
| CONFIG | /etc, ~/.config (non-opencode) | NO |
| SYSTEM | /bin, /usr, /System | NEVER |

## Dangerous Commands (BLOCKED)

- `rm -rf /` — recursive root delete
- `dd if=` — disk dump
- `mkfs` — format filesystem
- `fork bomb` — :(){ :|:& };:
- `chmod 777` — permission escalation
- `sudo` — privilege escalation (unless explicitly user-requested)

## Anti-Derailment Rules

1. NEVER test on host — container only
2. NEVER trust narration — raw tool output only
3. NEVER self-implement — spawn subagents for multi-file work
4. NEVER declare verified without container evidence
5. NEVER skip PSM when stuck
6. NEVER use cross-agent tools
7. NEVER claim "runtime grade" without audit

## PSM Activation Triggers

- 4+ consecutive read operations without progress
- Repeated error patterns (3+ identical errors)
- Stuck loops (same action repeated)
- Confusion indicators ("I'm not sure", "maybe")
- Knowledge gaps ("I don't know", "unclear")
- Theatrical claims ("appears to work", "should be fine")

---

*Manta v2.1 — Firewall Context*
