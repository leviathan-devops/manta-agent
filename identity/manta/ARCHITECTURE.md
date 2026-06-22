# IDENTITY INJECTION MECHANICS — CLEAR+REBUILD vs SCAN+REPLACE

## What the Bible Says (§V of OPERATIONAL_IDENTITY_BIBLE.md)

The Bible prescribes the **SCAN+REPLACE** pattern for identity injection via `system.transform`:

```
1. Scan the output.system array for runtime default strings ("opencode", "interactive CLI", etc.)
2. REPLACE that specific entry with the identity header
3. Fallback: if no runtime default found, unshift the identity header
```

The Bible's approach works by finding and overwriting the runtime's default system prompt entry.

## What MANTA v2.2.2 Actually Does: CLEAR+REBUILD

MANTA uses a fundamentally different approach at `hooks/v4.1/system-transform-hook.ts:157-160`:

```typescript
// ─── CLEAR and REBUILD ───
sys.system.length = 0;         // CLEAR: wipe the entire array
for (const w of warheads) {    // REBUILD: push warheads in priority order
  sys.system.push(w);
}
```

## Why CLEAR+REBUILD Is Better

### 1. Runtime Defaults Are WIPED, Not Overwritten

SCAN+REPLACE replaces ONE specific string ("You are opencode..."). The runtime can append MULTIPLE defaults after system.transform returns. CLEAR+REBUILD sets the array length to 0, which physically removes ALL entries — then rebuilds from warheads.

The runtime will append defaults AFTER system.transform returns, but the identity header (at position [0]) is now the FIRST thing the model sees. Runtime defaults come AFTER the identity header and are therefore less authoritative.

### 2. No String-Matching Fragility

SCAN+REPLACE relies on matching specific strings ("opencode", "interactive CLI"). If the runtime changes these strings in a new version, the scan fails and identity injection silently breaks. CLEAR+REBUILD has no string dependencies — it just wipes the array.

### 3. Predictable Warhead Order

CLEAR+REBUILD guarantees exact ordering of warheads:

```
[0]   Identity header           — Who we are
[0.5] T1 operational prompt     — HOW to operate (per agent)
[1]   RuntimeGradeEngineer      — Quality standards
[2]   identityWarhead           — Extracted from T2 files
[3]   enforcementWarhead        — Guardian rules
[4]   gateWarhead               — Gate chain
[5]   focusWarhead              — Task context (static)
[6]   Agent transition (if applicable) — On agent switch
[7]   Worker scope              — Per-agent
[8]   PSM mandate               — Plan brain only
```

This is deterministic and testable. SCAN+REPLACE doesn't guarantee position — the identity might end up at index 3 or index 7 depending on where the runtime default string was found.

### 4. No Deduplication Problems

SCAN+REPLACE requires a deduplication check ("has this been injected already?") to prevent double-injection on subsequent calls. The Bible describes this at §V 5.2:

```typescript
const hasIdentity = outputSys.some(s =>
  typeof s === 'string' && s.startsWith('[AGENT IDENTITY BINDING]')
);
if (hasIdentity) return;  // Already injected this session
```

CLEAR+REBUILD doesn't need this. Every call clears the array first. If identity was already there, it gets cleared. If it wasn't, it gets built. The result is always exactly one identity header — no dedup check needed, no edge cases where the dedup check fails.

### 5. Caching-Safe

CLEAR+REBUILD produces the EXACT same output for the same agent on every call. The warheads are static strings (topic for another doc). SCAN+REPLACE produces different output depending on whether the dedup check found an existing identity header or not — two different code paths with slightly different array content.

With CLEAR+REBUILD, for manta agent:
- Every call: `sys.system.length = 0; push(warhead[0]); push(warhead[0.5]); ... push(warhead[8])`
- Result: always the same array content → same system prompt hash → prompt caching works

## What We Kept From the Bible

1. **6-section identity header structure** (§III) — MANTA's `formatMantaIdentityHeader()` produces all 6 sections in the canonical order.

2. **T1 injectables after identity header** (§V 5.3) — Warheads at positions [1-5] come after the identity header at [0].

3. **Allowlist enforcement** (§VIII) — Guardian hook implements per-agent tool allowlists with prefix matching.

4. **Deduplication-free injection** — The Bible's dedup check (checking if identity was already injected) is obviated by CLEAR+REBUILD. No double-injection possible because we wipe first.

## What We Changed From the Bible

| Bible (§V) | MANTA v2.2.2 | Why |
|-----------|-------------|-----|
| SCAN+REPLACE (find one string, replace it) | CLEAR+REBUILD (wipe all, rebuild from warheads) | More robust, no string dependency, predictable order |
| unshift fallback | Never needed (CLEAR removes everything) | Simpler code path |
| Dedup check with startsWith | Not needed (CLEAR prevents doubling) | Fewer edge cases |
| Dynamic T0 warhead status lines | Static warheads only | Prevents caching catastrophe (see TRIDENT_PROMPT_CACHING_AUTOPSY.md) |

## Architectural Note

CLEAR+REBUILD is MANTA's own identity injection pattern. The core insight — "wipe the array, don't patch it" — emerged from the observation that runtime defaults kept winning when only patching individual entries.
The pattern is MANTA's own. The comment in the code uses "CLEAR+REBUILD" to reflect this design choice.
