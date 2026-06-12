// @bun
// src/shared/mode-coordinator.ts
class ModeCoordinator {
  modes;
  constructor() {
    this.modes = this.initializeModes();
  }
  initializeModes() {
    const modes = new Map;
    modes.set("planning", {
      name: "Deep Planning Mode",
      maxLayer: 3,
      layerNames: ["Initial Plan", "Detailed Workflow", "Context Library"],
      requirements: new Map([
        [1, [
          { name: "surfaceUnderstanding", description: "Surface understanding documented", validate: (a) => this.checkArtifact(a, "surfaceUnderstanding") },
          { name: "firstPrinciples", description: "3+ first principles stated", validate: (a) => this.checkPrincipleCount(a, "firstPrinciples", 3) },
          { name: "constraints", description: "3+ constraints identified", validate: (a) => this.checkPrincipleCount(a, "constraints", 3) },
          { name: "successCriteria", description: "Success criteria defined", validate: (a) => this.checkArtifact(a, "successCriteria") },
          { name: "openQuestions", description: "2+ open questions identified", validate: (a) => this.checkPrincipleCount(a, "openQuestions", 2) }
        ]],
        [2, [
          { name: "components", description: "5+ components identified", validate: (a) => this.checkPrincipleCount(a, "components", 5) },
          { name: "dependencies", description: "3+ dependencies mapped", validate: (a) => this.checkPrincipleCount(a, "dependencies", 3) },
          { name: "failureModes", description: "3+ failure modes identified", validate: (a) => this.checkPrincipleCount(a, "failureModes", 3) }
        ]],
        [3, [
          { name: "contextLibrary", description: "Context library generated", validate: (a) => this.checkArtifact(a, "contextLibrary") },
          { name: "injectableOutput", description: "Output is injectable format", validate: (a) => this.checkArtifact(a, "injectableOutput") }
        ]]
      ]),
      allowedTools: ["read", "grep", "glob", "ls", "extract_code_blocks", "symbols", "imports", "write", "write_file"],
      blockedTools: ["bash", "shell", "npm", "pip", "curl", "docker", "terminal"]
    });
    modes.set("problem-solving", {
      name: "Problem Solving Mode",
      maxLayer: 6,
      layerNames: ["Assumption", "Action", "Observation", "Gap Analysis", "Meta-Reflection", "Verification"],
      requirements: new Map([
        [1, [
          { name: "explicitAssumption", description: "Explicit assumption stated", validate: (a) => this.checkArtifact(a, "assumption") },
          { name: "reasoningChain", description: "Reasoning chain documented", validate: (a) => this.checkArtifact(a, "reasoningChain") },
          { name: "successCriteria", description: "Success criteria defined", validate: (a) => this.checkArtifact(a, "successCriteria") },
          { name: "confirmationCriteria", description: "Confirmation/disproof criteria defined", validate: (a) => this.checkArtifact(a, "confirmationCriteria") }
        ]],
        [2, [
          { name: "exactCommand", description: "Exact command specified", validate: (a) => this.checkArtifact(a, "exactCommand") },
          { name: "expectedOutput", description: "Expected output documented", validate: (a) => this.checkArtifact(a, "expectedOutput") },
          { name: "environmentState", description: "Environment state captured", validate: (a) => this.checkArtifact(a, "environmentState") }
        ]],
        [3, [
          { name: "rawEvidence", description: "Raw evidence captured (not paraphrased)", validate: (a) => this.checkArtifact(a, "rawEvidence") },
          { name: "logsChecked", description: "Logs checked", validate: (a) => this.checkArtifact(a, "logsChecked") },
          { name: "expectedVsActual", description: "Expected vs actual comparison table", validate: (a) => this.checkArtifact(a, "expectedVsActual") }
        ]],
        [4, [
          { name: "gapAnalysis", description: "Gap analysis documented", validate: (a) => this.checkArtifact(a, "gapAnalysis") },
          { name: "updatedHypothesis", description: "Updated hypothesis stated", validate: (a) => this.checkArtifact(a, "updatedHypothesis") },
          { name: "nextAction", description: "Next action tied to insight", validate: (a) => this.checkArtifact(a, "nextAction") }
        ]],
        [5, [
          { name: "whatIShouldHaveDone", description: '"What I Should Have Done" documented', validate: (a) => this.checkArtifact(a, "whatIShouldHaveDone") },
          { name: "patternExtracted", description: "Pattern extracted", validate: (a) => this.checkArtifact(a, "patternExtracted") },
          { name: "systemicIssue", description: "Systemic issue identified", validate: (a) => this.checkArtifact(a, "systemicIssue") }
        ]],
        [6, [
          { name: "targetEnvironmentExecution", description: "Target environment execution verified", validate: (a) => this.checkArtifact(a, "targetEnvironment") },
          { name: "behaviorMatches", description: "Behavior matches requirement", validate: (a) => this.checkArtifact(a, "behaviorMatches") },
          { name: "noRegressions", description: "Regression check performed", validate: (a) => this.checkArtifact(a, "regressionCheck") }
        ]]
      ]),
      allowedTools: ["read", "grep", "glob", "ls", "extract_code_blocks", "symbols", "imports", "write", "write_file"],
      blockedTools: ["bash", "shell", "npm", "pip", "curl", "docker", "terminal"]
    });
    modes.set("context-synthesis", {
      name: "Context Synthesis Mode",
      maxLayer: 4,
      layerNames: ["Collection", "Scoring", "Compression", "Injection"],
      requirements: new Map([
        [1, [
          { name: "t1SessionContext", description: "T1 session context checked", validate: (a) => this.checkArtifact(a, "t1Session") },
          { name: "t2KnowledgeContext", description: "T2 knowledge context checked", validate: (a) => this.checkArtifact(a, "t2Knowledge") },
          { name: "t3FileContext", description: "T3 file context checked", validate: (a) => this.checkArtifact(a, "t3Files") },
          { name: "t4ToolContext", description: "T4 tool context checked", validate: (a) => this.checkArtifact(a, "t4Tools") }
        ]],
        [2, [
          { name: "allContextScored", description: "All context items scored", validate: (a) => this.checkArtifact(a, "allScored") },
          { name: "rankedByScore", description: "Context ranked by final score", validate: (a) => this.checkArtifact(a, "ranked") },
          { name: "topPriorities", description: "Top priorities identified", validate: (a) => this.checkArtifact(a, "priorities") }
        ]],
        [3, [
          { name: "underTokenLimit", description: "Under 2k token limit", validate: (a) => this.checkArtifact(a, "underLimit") },
          { name: "decisionsPreserved", description: "Decision points preserved", validate: (a) => this.checkArtifact(a, "decisionsPreserved") },
          { name: "keyInsights", description: "Key insights intact", validate: (a) => this.checkArtifact(a, "insightsPreserved") }
        ]],
        [4, [
          { name: "currentPosition", description: "Current position documented", validate: (a) => this.checkArtifact(a, "currentPosition") },
          { name: "priorities", description: "Priorities documented", validate: (a) => this.checkArtifact(a, "injectionPriorities") },
          { name: "synthesizedInsight", description: "Synthesized insight included", validate: (a) => this.checkArtifact(a, "synthesizedInsight") }
        ]]
      ]),
      allowedTools: ["read", "grep", "glob", "ls", "hermes_remember", "hive_context", "memread_session", "kraken_hive_search", "write", "write_file"],
      blockedTools: ["bash", "shell", "npm", "pip", "curl", "docker", "terminal"]
    });
    return modes;
  }
  checkArtifact(artifacts, key) {
    if (artifacts.has(key)) {
      return { valid: true };
    }
    return { valid: false, missing: [key], reason: `Missing artifact: ${key}` };
  }
  checkPrincipleCount(artifacts, key, minCount) {
    const value = artifacts.get(key);
    if (!value) {
      return { valid: false, missing: [key], reason: `Missing: ${key}` };
    }
    const items = value.split(`
`).filter((l) => l.trim().length > 0);
    if (items.length >= minCount) {
      return { valid: true };
    }
    return { valid: false, reason: `Expected ${minCount}+ items, found ${items.length}` };
  }
  getMaxLayer(mode) {
    return this.modes.get(mode)?.maxLayer || 0;
  }
  getModeDefinition(mode) {
    return this.modes.get(mode);
  }
  validateTool(tool, mode) {
    const modeDef = this.modes.get(mode);
    if (!modeDef) {
      return { valid: true };
    }
    if (modeDef.blockedTools.includes(tool)) {
      return { valid: false, reason: `${tool} is blocked in ${modeDef.name}` };
    }
    return { valid: true };
  }
  canAdvance(mode, currentLayer, artifacts) {
    const modeDef = this.modes.get(mode);
    if (!modeDef)
      return false;
    const requirements = modeDef.requirements.get(currentLayer);
    if (!requirements)
      return false;
    const results = requirements.map((req) => req.validate(artifacts));
    const allValid = results.every((r) => r.valid);
    return allValid;
  }
  getRequirements(mode, layer) {
    const modeDef = this.modes.get(mode);
    if (!modeDef)
      return [];
    return modeDef.requirements.get(layer) || [];
  }
}

// src/modes/planning/index.ts
class PlanningMode {
  name = "Deep Planning Mode";
  state = {
    layer1: null,
    layer2: null,
    layer3: null
  };
  getLayer(layer) {
    switch (layer) {
      case 1:
        return "Initial Plan";
      case 2:
        return "Detailed Workflow";
      case 3:
        return "Context Library";
      default:
        return "Unknown";
    }
  }
  setLayerOutput(layer, output) {
    switch (layer) {
      case 1:
        this.state.layer1 = output;
        break;
      case 2:
        this.state.layer2 = output;
        break;
      case 3:
        this.state.layer3 = output;
        break;
    }
  }
  getAllOutputs() {
    return {
      layer1: this.state.layer1,
      layer2: this.state.layer2,
      layer3: this.state.layer3
    };
  }
  reset() {
    this.state = { layer1: null, layer2: null, layer3: null };
  }
}
var planning_default = new PlanningMode;

// src/modes/problem-solving/index.ts
class ProblemSolvingMode {
  name = "Problem Solving Mode";
  currentIteration = "V1.0";
  iterationHistory = new Map;
  state = {
    layer1: null,
    layer2: null,
    layer3: null,
    layer4: null,
    layer5: null,
    layer6: null
  };
  getLayer(layer) {
    const layers = [
      "Assumption Statement",
      "Action with Prediction",
      "Observation & Evidence",
      "Gap Analysis & Adjustment",
      "Meta-Cognitive Reflection",
      "Verification & Confirmation"
    ];
    return layers[layer - 1] || "Unknown";
  }
  setLayerOutput(layer, output) {
    switch (layer) {
      case 1:
        this.state.layer1 = output;
        break;
      case 2:
        this.state.layer2 = output;
        break;
      case 3:
        this.state.layer3 = output;
        break;
      case 4:
        this.state.layer4 = output;
        break;
      case 5:
        this.state.layer5 = output;
        break;
      case 6:
        this.state.layer6 = output;
        break;
    }
  }
  getAllOutputs() {
    return { ...this.state };
  }
  newIteration() {
    this.iterationHistory.set(this.currentIteration, { ...this.state });
    const [major, minor] = this.currentIteration.split(".");
    const newMinor = parseInt(minor) + 1;
    this.currentIteration = `${major}.${newMinor}`;
    this.state = {
      layer1: null,
      layer2: null,
      layer3: null,
      layer4: null,
      layer5: null,
      layer6: null
    };
  }
  getCurrentIteration() {
    return this.currentIteration;
  }
  getIterationHistory() {
    return this.iterationHistory;
  }
  reset() {
    this.state = { layer1: null, layer2: null, layer3: null, layer4: null, layer5: null, layer6: null };
    this.currentIteration = "V1.0";
    this.iterationHistory.clear();
  }
}
var problem_solving_default = new ProblemSolvingMode;

// src/modes/context-synthesis/index.ts
class ContextSynthesisMode {
  name = "Context Synthesis Mode";
  TOKEN_BUDGET = 2000;
  DECISION_BUDGET = 500;
  state = {
    layer1: null,
    layer2: null,
    layer3: null,
    layer4: null
  };
  getLayer(layer) {
    const layers = ["Context Collection", "Relevance Scoring", "Compression", "Injection Format"];
    return layers[layer - 1] || "Unknown";
  }
  setLayerOutput(layer, output) {
    switch (layer) {
      case 1:
        this.state.layer1 = output;
        break;
      case 2:
        this.state.layer2 = output;
        break;
      case 3:
        this.state.layer3 = output;
        break;
      case 4:
        this.state.layer4 = output;
        break;
    }
  }
  getAllOutputs() {
    return { ...this.state };
  }
  calculateScore(urgency, importance) {
    return urgency * 0.6 + importance * 0.4;
  }
  getUrgencyScore(context) {
    if (context.hasBlocker)
      return 10;
    if (context.gateTransitionPending)
      return 8;
    if (context.isDebugging)
      return 7;
    if (context.hasRecentError)
      return 6;
    if (context.isStale)
      return 1;
    return 3;
  }
  getImportanceScore(context) {
    if (context.isDecisionPoint)
      return 10;
    if (context.isFromPattern)
      return 8;
    if (context.isConfigOrArchitecture)
      return 7;
    if (context.isDocumentation)
      return 3;
    if (context.isLogFile)
      return 2;
    return 5;
  }
  checkTriggers(triggerData) {
    const triggers = [];
    if (triggerData.manualRequested) {
      triggers.push({ type: "manual", priority: "HIGH" });
    }
    if (triggerData.gateChanging) {
      triggers.push({ type: "gate-transition", priority: "HIGH" });
    }
    if (triggerData.toolFailed) {
      triggers.push({ type: "error-detected", priority: "MEDIUM" });
    }
    if (triggerData.tokenPercentage > 0.7) {
      triggers.push({ type: "token-threshold", priority: "MEDIUM" });
    }
    if (triggerData.messagesSinceProgress > 10) {
      triggers.push({ type: "stale-context", priority: "LOW" });
    }
    return triggers;
  }
  generateInjection() {
    const output = this.state.layer4;
    if (!output)
      return "";
    return `# CONTEXT INJECTION \u2014 ${output.timestamp}

---

## \uD83D\uDCCD CURRENT POSITION
**Gate:** ${output.currentPosition.gate}
**Task:** ${output.currentPosition.task}
**Blockers:** ${output.currentPosition.blockers.length > 0 ? output.currentPosition.blockers.join(", ") : "None"}

---

## \uD83C\uDFAF IMMEDIATE PRIORITIES (Ranked)
${output.priorities.slice(0, 5).map((p, i) => `${i + 1}. **${p.name}** (${p.finalScore.toFixed(1)}) - ${p.content.substring(0, 100)}...`).join(`
`)}

---

## \uD83E\uDDE0 INJECTED KNOWLEDGE
${output.injectedKnowledge}

---

## \uD83D\uDCC1 ACTIVE FILES
${output.activeFiles.map((f) => `- ${f}`).join(`
`)}

---

## \uD83D\uDD27 RECENT EXECUTION
${output.executionPatterns.map((p) => `- ${p}`).join(`
`)}

---

## \uD83D\uDCA1 SYNTHESIZED INSIGHT
${output.synthesizedInsight}

---

---
**Token Count:** ${output.tokenCount} | **Sources:** ${output.sourceCount}
`;
  }
  reset() {
    this.state = { layer1: null, layer2: null, layer3: null, layer4: null };
  }
}
var context_synthesis_default = new ContextSynthesisMode;

// src/index.ts
class TridentBrainPlugin {
  name = "trident-brain";
  version = "1.0.0";
  coordinator;
  planningMode;
  problemSolvingMode;
  contextSynthesisMode;
  state = {
    currentMode: null,
    currentLayer: 0,
    iteration: "V1.0",
    artifacts: new Map
  };
  constructor() {
    this.coordinator = new ModeCoordinator;
    this.planningMode = new PlanningMode;
    this.problemSolvingMode = new ProblemSolvingMode;
    this.contextSynthesisMode = new ContextSynthesisMode;
  }
  initialize() {
    console.log("[Trident Brain] Initializing v1.0.0");
    console.log("[Trident Brain] Modes available: planning, problem-solving, context-synthesis");
  }
  createHooks() {
    return {
      "session.created": (event) => {
        console.log("[Trident Brain] Session created, initializing brain state");
        this.state.currentMode = null;
        this.state.currentLayer = 0;
        this.state.iteration = "V1.0";
        this.state.artifacts.clear();
      },
      "chat.message": (event) => {
        const message = (event.message || "").toLowerCase();
        if (message.includes("/trident")) {
          this.handleTridentCommand(event);
        }
      },
      "tool.execute.before": async (input, output) => {
        if (!this.state.currentMode)
          return;
        const tool = input.tool;
        const validation = this.coordinator.validateTool(tool, this.state.currentMode);
        if (!validation.valid) {
          console.log(`[Trident Brain] Tool blocked: ${tool} - ${validation.reason}`);
          output.blocked = true;
          output.blockReason = validation.reason;
        }
      },
      "tool.execute.after": async (input, output) => {
        if (!this.state.currentMode)
          return;
        this.evaluateGateProgression();
      }
    };
  }
  handleTridentCommand(event) {
    const message = event.message || "";
    if (message.includes("planning")) {
      this.state.currentMode = "planning";
      this.state.currentLayer = 1;
      event.response = "[Trident Brain] Switched to Deep Planning Mode (Layer 1)";
    } else if (message.includes("problem-solving")) {
      this.state.currentMode = "problem-solving";
      this.state.currentLayer = 1;
      event.response = "[Trident Brain] Switched to Problem Solving Mode (Layer 1)";
    } else if (message.includes("context-synthesis")) {
      this.state.currentMode = "context-synthesis";
      this.state.currentLayer = 1;
      event.response = "[Trident Brain] Switched to Context Synthesis Mode (Layer 1)";
    } else if (message.includes("status")) {
      event.response = this.getStatus();
    }
  }
  getStatus() {
    return `[Trident Brain] Status:
Mode: ${this.state.currentMode || "None"}
Layer: ${this.state.currentLayer}
Iteration: ${this.state.iteration}
Artifacts: ${this.state.artifacts.size}`;
  }
  evaluateGateProgression() {
    if (!this.state.currentMode)
      return;
    const mode = this.state.currentMode;
    const layer = this.state.currentLayer;
    const canAdvance = this.coordinator.canAdvance(mode, layer, this.state.artifacts);
    if (canAdvance && layer < this.coordinator.getMaxLayer(mode)) {
      this.state.currentLayer++;
      console.log(`[Trident Brain] Advanced to Layer ${this.state.currentLayer}`);
    } else if (canAdvance && layer === this.coordinator.getMaxLayer(mode)) {
      console.log(`[Trident Brain] Mode complete!`);
    }
  }
  createTools() {
    return [
      {
        name: "trident-status",
        description: "Get current Trident Brain status",
        execute: () => this.getStatus()
      },
      {
        name: "trident-mode",
        description: "Switch Trident Brain mode",
        execute: (mode) => {
          this.handleTridentCommand({ message: mode });
          return `Switched to ${mode}`;
        }
      },
      {
        name: "trident-artifact",
        description: "Get Trident Brain artifact",
        execute: (key) => {
          return this.state.artifacts.get(key) || "Not found";
        }
      }
    ];
  }
}
var src_default = new TridentBrainPlugin;
export {
  src_default as default,
  TridentBrainPlugin
};
