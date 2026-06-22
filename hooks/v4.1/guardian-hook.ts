import type { Hooks } from '@opencode-ai/plugin';
import { Guardian } from '../../shared/guardian.js';
import { getCurrentAgent } from './agent-state.js';

const VC_TOOLS = ['visual-cortex_analyze','visual-cortex_browser_capture_element','visual-cortex_browser_click','visual-cortex_browser_evaluate','visual-cortex_browser_navigate','visual-cortex_browser_press_key','visual-cortex_browser_screenshot','visual-cortex_browser_scroll','visual-cortex_browser_type','visual-cortex_capture','visual-cortex_cdp_status','visual-cortex_compare','visual-cortex_context','visual-cortex_epoch_summary','visual-cortex_health','visual-cortex_list_tiles','visual-cortex_recall','visual-cortex_semint_configure','visual-cortex_semint_start','visual-cortex_semint_status','visual-cortex_semint_stop','visual-cortex_spawn_container_tile','visual-cortex_status','visual-cortex_tv_draw_fibonacci','visual-cortex_tv_draw_horizontal_line','visual-cortex_tv_draw_trade_setup','visual-cortex_tv_draw_zone','visual-cortex_tv_get_backtest_results','visual-cortex_tv_get_visible_bars','visual-cortex_tv_open_chart','visual-cortex_tv_screenshot','visual-cortex_tv_set_timeframe','visual-cortex_tv_switch_symbol','visual-cortex_verify_tile'];
const RB_TOOLS = ['reasoning-bus_reasoning_channels','reasoning-bus_reasoning_check','reasoning-bus_reasoning_join','reasoning-bus_reasoning_post','reasoning-bus_reasoning_read','reasoning-bus_reasoning_resolve'];
const HIVE_READ_TOOLS = ['hive_context','hive_scan','hive_status','hive_trash_list','hive_trash_status'];
const HIVE_FULL_TOOLS = ['hive_remember','hive_forget','hive_purge','hive_restore'];
const ORCHESTRATOR_TOOLS = new Set(['task', 'manta-compaction', 'checkpoint', 'manta-status', 'manta-gate', 'manta-evidence', 'todowrite', ...VC_TOOLS, ...RB_TOOLS, ...HIVE_READ_TOOLS, ...HIVE_FULL_TOOLS]);
const PLAN_TOOLS = new Set(['read', 'glob', 'grep', 'webfetch', 'question', 'manta-code-review', 'checkpoint', 'ps-mode-status', 'ps-mode-layer', 'ps-mode-evidence', 'ps-mode-derail', 'ps-mode-debug', ...VC_TOOLS, ...RB_TOOLS, ...HIVE_READ_TOOLS]);
const EXEC_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'glob', 'grep', 'manta-spawn-container', 'manta-test-runner', 'manta-runtime-audit', 'manta-code-audit', 'manta-code-review', 'checkpoint', ...VC_TOOLS, ...RB_TOOLS, ...HIVE_READ_TOOLS]);
const FOREIGN_IDENTIFIERS = ['shark', 'kraken', 'spider', 'trident', 'hydra', 'hermes'];
function isForeignTool(tool: string): boolean {
  const lower = tool.toLowerCase();
  return FOREIGN_IDENTIFIERS.some(id => lower.includes(id)) && !lower.startsWith('manta');
}

const GLOBAL_OPENCODE_KILL_PATTERNS = [
  /^pkill\s+.*opencode/i,
  /^killall\s+.*opencode/i,
  /^kill\s+.*pgrep\s+.*opencode/i,
  /^kill\s+.*pidof\s+.*opencode/i,
  /pkill\s+-f\s+.*opencode/i,
];
function isGlobalOpencodeKill(command: string): boolean {
  if (/docker\s+exec\s+manta-container/i.test(command)) return false;
  return GLOBAL_OPENCODE_KILL_PATTERNS.some(p => p.test(command.trim()));
}

export function createGuardianHook(guardian: Guardian): Hooks['tool.execute.before'] {
  return async (input, output) => {
    const inputRec = input as Record<string, unknown>;
    const sessionId = String(inputRec?.sessionID ?? '');
    const sessionObj = inputRec?.session as Record<string, unknown> | undefined;
    const agentFromInput = String(inputRec?.agent ?? inputRec?.agentName ?? sessionObj?.agentName ?? '');
    const agent = getCurrentAgent(sessionId) || agentFromInput || '';
    const tool = input?.tool || '';
    const outputRec = output as Record<string, unknown>;
    const args = (outputRec?.args ?? inputRec?.args ?? {}) as Record<string, unknown>;

    // L0: Identity — only enforce for manta agents
    if (!agent) return;
    if (!agent.startsWith('manta')) return;

    // L0: Identity — foreign tool check
    if (isForeignTool(tool)) {
      throw new Error(`[FIREWALL_BLOCKED] L0: ${tool} not allowed. Use manta-* tools.`);
    }

    // L0: Identity — per-agent tool allowlists
    if (agent === 'manta') {
      const isAllowed = ORCHESTRATOR_TOOLS.has(tool) ||
        tool.startsWith('visual-cortex_') ||
        tool.startsWith('reasoning-bus_');
      if (!isAllowed) {
        throw new Error(`[FIREWALL_BLOCKED] L0: ${tool} denied. Use task(manta-plan/exec).`);
      }
    } else if (agent === 'manta-plan') {
      const isAllowed = PLAN_TOOLS.has(tool) || tool.startsWith('visual-cortex_') || tool.startsWith('reasoning-bus_');
      if (!isAllowed) throw new Error(`[FIREWALL_BLOCKED] L0: Plan read-only. ${tool} denied.`);
    } else if (agent === 'manta-exec') {
      const isAllowed = EXEC_TOOLS.has(tool) || tool.startsWith('visual-cortex_') || tool.startsWith('reasoning-bus_');
      if (!isAllowed) throw new Error(`[FIREWALL_BLOCKED] L0: Exec cannot use ${tool}.`);
    }

    // L1: Theatrical — detect mock/stub/simulate patterns in bash
    if (tool === 'bash') {
      const command = String((args as Record<string, unknown>)?.command || (args as Record<string, unknown>)?.cmd || '');
      if (/mock|stub|fake|pretend|simulate/i.test(command)) {
        throw new Error(`[FIREWALL_BLOCKED] L1: Mock cmd blocked. Real impl required.`);
      }
    }

    // L2: Anti-Superficial — validate content has substance
    if (tool === 'write' || tool === 'edit') {
      const content = String((args as Record<string, unknown>)?.content || '');
      if (content && content.length < 10) {
        throw new Error(`[FIREWALL_BLOCKED] L2: Content ${content.length} chars. Too short.`);
      }
    }

    // L3: Containment — zone restriction for writes
    if (tool === 'write' || tool === 'edit') {
      const filePath = String((args as Record<string, unknown>)?.filePath || '');
      if (filePath && !guardian.canWrite(filePath)) {
        throw new Error(`[FIREWALL_BLOCKED] L3: Zone restrict: ${filePath}`);
      }
    }

    // L4: Runtime — dangerous commands + global kill detection
    if (tool === 'bash') {
      const command = String((args as Record<string, unknown>)?.command || (args as Record<string, unknown>)?.cmd || '');
      // rm -rf firewall — block any rm -rf (even inside container)
      if (/rm\s+-rf/i.test(command)) {
        throw new Error(`[FIREWALL_BLOCKED] L4: rm -rf blocked. Use targeted file removal only.`);
      }
      if (guardian.isDangerousCommand(command)) throw new Error(`[FIREWALL_BLOCKED] L4: Dangerous cmd.`);
      if (isGlobalOpencodeKill(command)) throw new Error(`[FIREWALL_BLOCKED] L4: Global kill. Use docker exec manta pkill`);
    }
  };
}
