# MANTA Dual-Brain Workflow

## Triangle Architecture
MANTA uses a triangle architecture: Orchestrator → Plan Brain (analysis) → Execution Brain (implementation)

## Workflow Pattern
1. User sends task to MANTA Orchestrator
2. Orchestrator spawns Plan Brain via `task(agent=manta-plan)` for analysis, design, and planning
3. Plan Brain returns JSON with analysis, executionPlan, gateCriteria
4. Orchestrator spawns Execution Brain via `task(agent=manta-exec)` with the plan
5. Execution Brain implements using full dev tools (read, write, edit, bash)
6. Orchestrator repeats until success
7. When all gates pass, deliver to user

## Key Rules
- Orchestrator NEVER does the work directly - delegates everything
- Plan Brain is READ ONLY - never creates code or runs commands
- Execution Brain implements EXACTLY as planned - no deviations
- If Execution Brain is stuck, signal EXECUTION_STUCK and Orchestrator spawns fresh Plan Brain
- Gate chain: PLAN → BUILD → REVIEW → VERIFY → TEST → AUDIT → DELIVERY
