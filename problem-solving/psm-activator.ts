/**
 * PSM Activator v2.2.2 — Contextually Aware Reasoning Firewall
 *
 * Three-tier activation ladder:
 *   Tier 1: PROACTIVE — task complexity classification at session start
 *   Tier 2: TOOL INTERCEPTION — write/edit blocking without layer evidence
 *   Tier 3: ADAPTIVE RETRY — dynamic thresholds scaled by task complexity
 *
 * Monitors the agent's session state across turns and activates
 * Problem Solving Mode when it detects the agent is stuck, about
 * to hallucinate, or operating without evidence.
 */

export type TaskComplexity = 'trivial' | 'simple' | 'complex';

export type ActivationPattern =
  | 'repeated-error'
  | 'empty-result'
  | 'no-progress'
  | 'confusion'
  | 'knowledge-gap'
  | 'theatrical-claim'
  | 'stuck-loop'
  | 'hallucination-risk'
  | 'complex-task'
  | 'read-heavy-loop'
  | 'write-without-evidence';

export interface ActivationResult {
  activated: boolean;
  pattern?: ActivationPattern;
  reason?: string;
  directive?: string;
  confidence: number;
}

export interface ToolCallRecord {
  tool: string;
  args: string;
  result: string;
  isError: boolean;
  timestamp: number;
  turnNumber: number;
}

export interface SessionState {
  sessionId: string;
  agentName: string;
  turnCount: number;
  toolCalls: ToolCallRecord[];
  errorCount: number;
  consecutiveErrors: number;
  lastProgressTurn: number;
  questionCount: number;
  stuckCounter: number;
  psmActive: boolean;
  psmActivatedAt: number;
  lastActivationPattern: ActivationPattern | null;
  taskComplexity: TaskComplexity;
  consecutiveReads: number;
  writeActionCount: number;
}

const MAX_TRACKED_CALLS = 30;
const DEFAULT_STUCK_THRESHOLD = 5;
const DEFAULT_ERROR_REPEAT_THRESHOLD = 3;
const NO_PROGRESS_THRESHOLD = 2;
const CONFUSION_THRESHOLD = 1;
const READ_HEAVY_THRESHOLD = 4;

const sessionStates = new Map<string, SessionState>();

function classifyTaskComplexity(userMessage: string): TaskComplexity {
  if (!userMessage || userMessage.trim().length < 5) return 'trivial';

  const complexPatterns = [
    /\b(debug|fix|troubleshoot|diagnose)\b/i,
    /\b(broken|failing|crashing|error|bug)\b/i,
    /\b(build|create|implement|develop)\b.*\b(from scratch|new|entire|full|complete)\b/i,
    /\b(solve|resolve|figure out)\b/i,
    /\b(refactor|rewrite|redesign|rearchitect|overhaul)\b/i,
    /\b(why\s+(is|does|did|doesn't|isn't|won't|can't))\b/i,
    /\b(how\s+(do|does|can|should|would)\s+I)\b/i,
    /\bdoesn't\s+work\b/i,
    /\bnot\s+working\b/i,
  ];

  const isComplex = complexPatterns.some(p => p.test(userMessage));

  if (isComplex) return 'complex';

  const simplePatterns = [
    /\b(add|change|update|modify|remove|delete|rename)\b.*\b(file|function|variable|config|setting)\b/i,
    /\b(read|show|display|list|print|cat)\b/i,
    /\b(write|create)\b.*\b(a|one|single|simple|small)\b/i,
    /\b(explain|what is|describe)\b/i,
  ];

  const isSimple = simplePatterns.some((p: RegExp) => p.test(userMessage));

  if (isSimple) return 'simple';
  if (userMessage.length > 100) return 'complex';
  return 'simple';
}

function getThresholds(complexity: TaskComplexity): { stuck: number; errorRepeat: number; readHeavy: number } {
  switch (complexity) {
    case 'complex':
      return { stuck: 3, errorRepeat: 2, readHeavy: 3 };
    case 'simple':
      return { stuck: 5, errorRepeat: 3, readHeavy: 4 };
    case 'trivial':
      return { stuck: 8, errorRepeat: 5, readHeavy: 6 };
  }
}

function getSessionState(sessionId: string, agentName: string): SessionState {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      sessionId,
      agentName,
      turnCount: 0,
      toolCalls: [],
      errorCount: 0,
      consecutiveErrors: 0,
      lastProgressTurn: 0,
      questionCount: 0,
      stuckCounter: 0,
      psmActive: false,
      psmActivatedAt: 0,
      lastActivationPattern: null,
      taskComplexity: 'simple',
      consecutiveReads: 0,
      writeActionCount: 0,
    });
  }
  return sessionStates.get(sessionId)!;
}

function setTaskComplexity(sessionId: string, complexity: TaskComplexity): void {
  const state = getSessionState(sessionId, 'manta');
  state.taskComplexity = complexity;
}

export function trackToolCall(
  sessionId: string,
  agentName: string,
  tool: string,
  args: string,
  result: string,
  isError: boolean
): void {
  const state = getSessionState(sessionId, agentName);
  state.turnCount++;

  const record: ToolCallRecord = {
    tool,
    args: args.substring(0, 500),
    result: result.substring(0, 1000),
    isError,
    timestamp: Date.now(),
    turnNumber: state.turnCount,
  };

  state.toolCalls.push(record);
  if (state.toolCalls.length > MAX_TRACKED_CALLS) {
    state.toolCalls.shift();
  }

  const isReadTool = tool === 'read' || tool === 'glob' || tool === 'grep' || tool === 'ls' || tool === 'bash';
  const isWriteTool = tool === 'write' || tool === 'edit' || tool === 'patch';
  const isPSMTool = tool.startsWith('ps-mode-');

  if (isWriteTool) {
    state.consecutiveReads = 0;
    state.writeActionCount++;
    state.lastProgressTurn = state.turnCount;
  } else if (isReadTool && !isPSMTool) {
    state.consecutiveReads++;
  } else {
    state.consecutiveReads = 0;
  }

  if (isError) {
    state.errorCount++;
    state.consecutiveErrors++;
  } else {
    state.consecutiveErrors = 0;
    state.lastProgressTurn = state.turnCount;
  }

  if (isQuestion(result)) {
    state.questionCount++;
  }

  state.stuckCounter = state.turnCount - state.lastProgressTurn;
}

function isQuestion(text: string): boolean {
  const questionPatterns = [
    /\?$/,
    /^what\s/i,
    /^how\s/i,
    /^could\syou/i,
    /^can\syou/i,
    /^would\syou/i,
    /^do\syou\s/i,
    /^are\syou\s/i,
    /^is\sit\s/i,
    /please\s+clarify/i,
    /please\s+provide/i,
    /i\s+don't\s+understand/i,
    /could\s+you\s+explain/i,
    /what\s+do\s+you\s+mean/i,
    /i\s+need\s+more\s+context/i,
  ];
  return questionPatterns.some((p: RegExp) => p.test(text.trim()));
}

function detectActivationPatterns(
  sessionId: string,
  agentName: string,
  lastResponse?: string,
  userMessage?: string
): ActivationResult {
  const state = getSessionState(sessionId, agentName);

  if (state.psmActive) {
    const timeSinceActivation = Date.now() - state.psmActivatedAt;
    if (timeSinceActivation < 120000) {
      return { activated: true, confidence: 1.0, pattern: state.lastActivationPattern!, reason: 'PSM already active' };
    }
    deactivatePSM(sessionId);
  }

  const checkReadHeavyLoop = checkReadHeavyLoopPattern(state);
  if (checkReadHeavyLoop.activated) return checkReadHeavyLoop;

  const complexTask = checkComplexTask(state, userMessage);
  if (complexTask.activated) return complexTask;

  const repeatedError = checkRepeatedError(state);
  if (repeatedError.activated) return repeatedError;

  const stuckLoop = checkStuckLoop(state);
  if (stuckLoop.activated) return stuckLoop;

  const noProgress = checkNoProgress(state);
  if (noProgress.activated) return noProgress;

  const confusion = checkConfusion(state);
  if (confusion.activated) return confusion;

  const knowledgeGap = checkKnowledgeGap(state, lastResponse);
  if (knowledgeGap.activated) return knowledgeGap;

  const theatrical = checkTheatricalClaim(state, lastResponse);
  if (theatrical.activated) return theatrical;

  const hallucination = checkHallucinationRisk(state, lastResponse);
  if (hallucination.activated) return hallucination;

  return { activated: false, confidence: 0 };
}

function _checkWriteWithoutEvidence(sessionId: string, tool: string): ActivationResult {
  const state = sessionStates.get(sessionId);
  if (!state || !state.psmActive) return { activated: false, confidence: 0 };

  const writeTools = ['write', 'edit', 'patch', 'write_file', 'mcp_write_file'];
  if (!writeTools.includes(tool)) return { activated: false, confidence: 0 };

  const recentPSMCalls = state.toolCalls.slice(-5).filter((tc: { tool: string; timestamp: number }) => tc.tool.startsWith('ps-mode-'));
  if (recentPSMCalls.length === 0) {
    return {
      activated: true,
      pattern: 'write-without-evidence',
      reason: 'PSM is active but agent is attempting to write without submitting layer evidence. Block write until ps-mode-layer is called.',
      confidence: 0.95,
    };
  }

  return { activated: false, confidence: 0 };
}

function checkReadHeavyLoopPattern(state: SessionState): ActivationResult {
  const thresholds = getThresholds(state.taskComplexity);
  if (state.consecutiveReads >= thresholds.readHeavy) {
    return {
      activated: true,
      pattern: 'read-heavy-loop',
      reason: `${state.consecutiveReads} consecutive read-only tool calls (read/glob/grep/ls) with no write/edit action. Agent is exploring without acting. Activating PSM.`,
      confidence: 0.85,
    };
  }
  return { activated: false, confidence: 0 };
}

function checkComplexTask(state: SessionState, userMessage?: string): ActivationResult {
  if (!userMessage || state.turnCount > 2) return { activated: false, confidence: 0 };
  if (state.taskComplexity !== 'complex') return { activated: false, confidence: 0 };

  const complexPatterns = [
    /\b(debug|fix|troubleshoot|diagnose)\b/i,
    /\b(broken|failing|crashing|error|bug)\b/i,
    /\b(build|create|implement|develop)\b.*\b(from scratch|new|entire)\b/i,
    /\b(solve|resolve|figure out)\b/i,
    /\bwhy\s+(is|does|do|did|doesn't|isn't|won't|can't)\b/i,
    /\bhow\s+(do|does|can|should|would)\b/i,
    /\bdoesn't\s+work\b/i,
    /\bnot\s+working\b/i,
    /\bfails?\b/i,
  ];

  const isComplex = complexPatterns.some((p: RegExp) => p.test(userMessage));
  if (isComplex && state.turnCount <= 1) {
    return {
      activated: true,
      pattern: 'complex-task',
      reason: `Complex task detected: "${userMessage.substring(0, 80)}". Activating Problem Solving Mode for structured approach.`,
      confidence: 0.8,
    };
  }
  return { activated: false, confidence: 0 };
}

function checkRepeatedError(state: SessionState): ActivationResult {
  const thresholds = getThresholds(state.taskComplexity);
  if (state.consecutiveErrors >= thresholds.errorRepeat) {
    const recentErrors = state.toolCalls
      .filter((tc: { tool: string; timestamp: number; isError: boolean; result: string }) => tc.isError)
      .slice(-thresholds.errorRepeat);

    const errorMessages = recentErrors.map((tc: { tool: string; timestamp: number; isError: boolean; result: string }) => tc.result.substring(0, 100));
    const allSimilar = errorMessages.every((e: string) =>
      e.includes(errorMessages[0].substring(0, 30))
    );

    return {
      activated: true,
      pattern: 'repeated-error',
      reason: `${state.consecutiveErrors} consecutive errors${allSimilar ? ' (same error repeating)' : ''}. The agent is stuck on the same problem.`,
      confidence: 0.95,
    };
  }
  return { activated: false, confidence: 0 };
}

function checkStuckLoop(state: SessionState): ActivationResult {
  const thresholds = getThresholds(state.taskComplexity);
  if (state.stuckCounter >= thresholds.stuck) {
    return {
      activated: true,
      pattern: 'stuck-loop',
      reason: `No progress for ${state.stuckCounter} tool calls. The agent is looping without advancing.`,
      confidence: 0.9,
    };
  }
  return { activated: false, confidence: 0 };
}

function checkNoProgress(state: SessionState): ActivationResult {
  const recentCalls = state.toolCalls.slice(-NO_PROGRESS_THRESHOLD);
  if (recentCalls.length < NO_PROGRESS_THRESHOLD) return { activated: false, confidence: 0 };

  const allReads = recentCalls.every((tc: { tool: string; timestamp: number; isError: boolean; result: string }) =>
    tc.tool === 'read' || tc.tool === 'glob' || tc.tool === 'grep'
  );

  const hasEmptyResults = recentCalls.some((tc: { tool: string; timestamp: number; isError: boolean; result: string }) => tc.result.trim().length < 10);

  if ((allReads && state.stuckCounter >= NO_PROGRESS_THRESHOLD) || hasEmptyResults) {
    return {
      activated: true,
      pattern: 'no-progress',
      reason: hasEmptyResults
        ? 'Tool returned empty/minimal results. Agent is searching but not finding.'
        : `${NO_PROGRESS_THRESHOLD} consecutive read-only tool calls with no write/action. Agent is exploring without acting.`,
      confidence: hasEmptyResults ? 0.8 : 0.85,
    };
  }
  return { activated: false, confidence: 0 };
}

function checkConfusion(state: SessionState): ActivationResult {
  if (state.questionCount >= CONFUSION_THRESHOLD) {
    const recentQuestions = state.toolCalls
      .slice(-3)
      .filter((tc: { tool: string; timestamp: number; isError: boolean; result: string }) => isQuestion(tc.result));

    if (recentQuestions.length >= 2) {
      return {
        activated: true,
        pattern: 'confusion',
        reason: `Agent asked ${state.questionCount} questions instead of acting. It doesn't know what to do.`,
        confidence: 0.8,
      };
    }
  }
  return { activated: false, confidence: 0 };
}

function checkKnowledgeGap(state: SessionState, lastResponse?: string): ActivationResult {
  const recentOutputs = state.toolCalls.slice(-3).map((tc: { tool: string; timestamp: number; isError: boolean; result: string }) => tc.result).join(' ');
  const combinedText = `${lastResponse || ''} ${recentOutputs}`;

  const gapIndicators = [
    /i\s+don'?t\s+(know|have|see|find)/i,
    /i'?m\s+not\s+(sure|certain|familiar)/i,
    /i\s+can'?t\s+(find|locate|determine)/i,
    /no\s+(files?|code|project|documentation|matches?|results?|output)/i,
    /unable\s+to\s+(find|locate|determine)/i,
    /not\s+(available|present|found)/i,
    /doesn'?t\s+(exist|seem|contain|have)/i,
    /does\s+not\s+(contain|have|include|match)/i,
    /i\s+would\s+need/i,
    /to\s+proceed\s+i\s+need/i,
    /no\s+output/i,
    /nothing\s+found/i,
    /no\s+such\s+file/i,
    /couldn'?t\s+find/i,
    /no\s+python\s+files/i,
    /only\s+one\s+python\s+file/i,
    /doesn'?t\s+have/i,
    /not\s+what\s+(you|i)\s+(expected|looking)/i,
    /this\s+doesn'?t\s+make\s+sense/i,
    /i'?m\s+confused/i,
    /i\s+think\s+i\s+need\s+to/i,
    /let\s+me\s+try\s+(another|a\s+different)/i,
    /maybe\s+(i|we|the|it)/i,
    /or\s+maybe/i,
    /wait,?\s+i\s+think/i,
  ];

  const hasGap = gapIndicators.some((p: RegExp) => p.test(combinedText));
  if (hasGap) {
    return {
      activated: true,
      pattern: 'knowledge-gap',
      reason: 'Agent expressed uncertainty or inability to find information. About to potentially hallucinate to fill the gap.',
      confidence: 0.75,
    };
  }
  return { activated: false, confidence: 0 };
}

function checkTheatricalClaim(state: SessionState, lastResponse?: string): ActivationResult {
  const recentOutputs = state.toolCalls.slice(-5).map((tc: { tool: string; timestamp: number; isError: boolean; result: string }) => tc.result).join(' ');
  const combinedText = `${lastResponse || ''} ${recentOutputs}`;

  const theatricalPatterns = [
    /it\s+works\s+(fine|correctly|properly|as\s+expected)/i,
    /everything\s+is\s+(working|fine|good|correct)/i,
    /no\s+(issues?|errors?|problems?|bugs?)\s+(found|detected)/i,
    /all\s+tests?\s+(pass|passed)/i,
    /successfully\s+(implemented|created|built|fixed)/i,
    /the\s+fix\s+is\s+(complete|done|working)/i,
    /i'?ve\s+(fixed|resolved|solved)/i,
    /this\s+should\s+(work|fix|resolve)/i,
  ];

  const hasTheatrical = theatricalPatterns.some((p: RegExp) => p.test(combinedText));

  const recentWrites = state.toolCalls.slice(-5).filter((tc: { tool: string; timestamp: number; isError: boolean; result: string }) =>
    tc.tool === 'write' || tc.tool === 'edit'
  );

  if (hasTheatrical && recentWrites.length === 0) {
    return {
      activated: true,
      pattern: 'theatrical-claim',
      reason: 'Agent claimed success/fix without any write/edit operations in recent turns. Likely hallucinating.',
      confidence: 0.85,
    };
  }
  return { activated: false, confidence: 0 };
}

function checkHallucinationRisk(state: SessionState, lastResponse?: string): ActivationResult {
  const recentOutputs = state.toolCalls.slice(-3).map((tc: { tool: string; timestamp: number; isError: boolean; result: string }) => tc.result).join(' ');
  const combinedText = `${lastResponse || ''} ${recentOutputs}`;

  const hallucinationPatterns = [
    /here'?s?\s+(how|what|the)\s+(you|we)\s+(can|should|could)\s+(do|fix|solve)/i,
    /the\s+(solution|fix|approach|answer)\s+(is|would\s+be)/i,
    /you\s+(should|could|might)\s+(try|consider|use)/i,
    /based\s+on\s+(my|the)\s+(analysis|understanding|knowledge)/i,
    /in\s+(my|general)\s+(experience|understanding)/i,
    /typically|usually|generally|normally/i,
  ];

  const hasHallucinationRisk = hallucinationPatterns.some((p: RegExp) => p.test(combinedText));

  const recentEvidence = state.toolCalls.slice(-3).filter((tc: { tool: string; timestamp: number; isError: boolean; result: string }) =>
    tc.tool === 'bash' || tc.tool === 'terminal'
  );

  if (hasHallucinationRisk && recentEvidence.length === 0 && state.stuckCounter > 2) {
    return {
      activated: true,
      pattern: 'hallucination-risk',
      reason: 'Agent is providing solutions/advice without running any commands. No evidence gathered. High hallucination risk.',
      confidence: 0.8,
    };
  }
  return { activated: false, confidence: 0 };
}

function activatePSM(sessionId: string, pattern: ActivationPattern): void {
  const state = sessionStates.get(sessionId);
  if (state) {
    state.psmActive = true;
    state.psmActivatedAt = Date.now();
    state.lastActivationPattern = pattern;
  }
}

function deactivatePSM(sessionId: string): void {
  const state = sessionStates.get(sessionId);
  if (state) {
    state.psmActive = false;
    state.lastActivationPattern = null;
  }
}

function buildActivationDirective(result: ActivationResult, state: SessionState): string {
  if (!result.activated || !result.pattern) return '';

  const layerGuidance = state.psmActive && state.lastActivationPattern
    ? `You are currently at Layer ${getCurrentLayer(state)} of Problem Solving Mode.`
    : '';

  return `
[PSM ACTIVATOR — COGNITIVE OVERRIDE]
PROBLEM SOLVING MODE ACTIVATED

Detection: ${result.pattern}
Reason: ${result.reason}
Confidence: ${(result.confidence * 100).toFixed(0)}%

YOU MUST IMMEDIATELY:
1. STOP whatever you are currently doing
2. Use ps-mode-layer action=current to check your current layer
3. Use ps-mode-layer action=submit to submit content for that layer
4. Do NOT proceed without using the ps-mode-layer tool
5. Every response MUST include a ps-mode-layer tool call

${layerGuidance}

WHY THIS ACTIVATED:
The system detected you are ${getStuckDescription(result.pattern)}.
Instead of hallucinating or looping, you MUST use the structured
problem-solving pipeline to work through the problem methodically.

TOOL USAGE IS MANDATORY — Text-only responses are BLOCKED.
You MUST call ps-mode-layer in every response until the problem is solved.
`.trim();
}

function getCurrentLayer(state: SessionState): number {
  const layerPasses = state.toolCalls.filter(
    (tc: { tool: string; result: string; timestamp: number; isError: boolean }) => tc.tool === 'ps-mode-layer' && tc.result.includes('passed')
  );
  return Math.min(layerPasses.length + 1, 6);
}

function getStuckDescription(pattern: ActivationPattern): string {
  switch (pattern) {
    case 'repeated-error': return 'hitting the same error repeatedly without changing approach';
    case 'stuck-loop': return 'looping without making progress';
    case 'no-progress': return 'reading files without taking action';
    case 'confusion': return 'asking questions instead of solving the problem';
    case 'knowledge-gap': return 'expressing uncertainty about what to do next';
    case 'theatrical-claim': return 'claiming success without evidence';
    case 'hallucination-risk': return 'about to provide solutions without running commands';
    case 'complex-task': return 'facing a complex task that requires structured problem-solving';
    case 'read-heavy-loop': return 'exploring files without making changes — stuck in research mode';
    case 'write-without-evidence': return 'attempting to write code without PSM layer evidence';
    default: return 'stuck on a problem';
  }
}

function clearSessionState(sessionId: string): void {
  sessionStates.delete(sessionId);
}

function getAllSessionStates(): Map<string, SessionState> {
  return new Map(sessionStates);
}
