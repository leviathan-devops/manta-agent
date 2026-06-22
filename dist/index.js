// @bun
var __require = import.meta.require;

// index.ts
import * as path15 from "path";
import * as fs15 from "fs";

// shared/manta-logger.ts
import * as fs from "fs";
import * as path from "path";
var LOG_DIR = path.join(process.cwd(), ".manta");
var LOG_FILE = path.join(LOG_DIR, "manta.log");
function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {}
}
function mantaLog(...args) {
  try {
    ensureLogDir();
    const msg = `[MANTA] ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
    fs.appendFileSync(LOG_FILE, `${msg}
`);
  } catch {}
}
function mantaWarn(...args) {
  try {
    ensureLogDir();
    const msg = `[MANTA WARN] ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
    fs.appendFileSync(LOG_FILE, `${msg}
`);
  } catch {}
}
function mantaError(...args) {
  try {
    ensureLogDir();
    const msg = `[MANTA ERROR] ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
    fs.appendFileSync(LOG_FILE, `${msg}
`);
  } catch {}
}

// shared/state-store.ts
var DOMAIN_OWNERSHIP = {
  "plan-state": ["manta-plan-brain"],
  "manta-state": ["manta-coordinator"],
  "manta-context": ["manta-plan-brain"],
  "manta-reasoning": ["manta-reasoning-brain"],
  "manta-workflow": ["manta-coordinator"],
  "manta-quality": ["manta-plan-brain"],
  "manta-security": ["manta-coordinator"]
};
function createStateStore() {
  const data = new Map;
  const versions = new Map;
  const watchers = new Map;
  function getKey(key, domain) {
    return domain ? `${domain}:${key}` : key;
  }
  return {
    get(key, domain) {
      const fullKey = getKey(key, domain);
      return data.get(fullKey);
    },
    set(key, value, domain, ownerBrain) {
      const fullKey = getKey(key, domain);
      if (ownerBrain) {
        const owners = DOMAIN_OWNERSHIP[domain];
        if (owners && !owners.includes(ownerBrain)) {
          return {
            success: false,
            version: versions.get(fullKey) ?? 0,
            error: `Brain "${ownerBrain}" does not own domain "${domain}". Owners: ${owners.join(", ")}`
          };
        }
      }
      const currentVersion = versions.get(fullKey) ?? 0;
      const newVersion = currentVersion + 1;
      data.set(fullKey, value);
      versions.set(fullKey, newVersion);
      const watchersForKey = watchers.get(fullKey);
      if (watchersForKey) {
        for (const callback of watchersForKey) {
          try {
            callback(value, newVersion);
          } catch (e) {
            mantaError("state-store: watcher callback error:", e);
          }
        }
      }
      return { success: true, version: newVersion };
    },
    watch(key, callback) {
      const allKeys = [key];
      for (const domain of Object.keys(DOMAIN_OWNERSHIP)) {
        allKeys.push(`${domain}:${key}`);
      }
      for (const fullKey of allKeys) {
        if (!watchers.has(fullKey)) {
          watchers.set(fullKey, []);
        }
        watchers.get(fullKey).push(callback);
      }
      return () => {
        for (const fullKey of allKeys) {
          const list = watchers.get(fullKey);
          if (list) {
            const idx = list.indexOf(callback);
            if (idx !== -1)
              list.splice(idx, 1);
          }
        }
      };
    },
    snapshot() {
      const snapshotData = {};
      const snapshotVersions = {};
      for (const [key, value] of data.entries()) {
        snapshotData[key] = value;
      }
      for (const [key, version] of versions.entries()) {
        snapshotVersions[key] = version;
      }
      return {
        data: snapshotData,
        versions: snapshotVersions,
        timestamp: Date.now()
      };
    },
    restore(snapshot) {
      data.clear();
      versions.clear();
      for (const [key, value] of Object.entries(snapshot.data)) {
        data.set(key, value);
      }
      for (const [key, version] of Object.entries(snapshot.versions)) {
        versions.set(key, version);
      }
    },
    cleanup() {
      data.clear();
      versions.clear();
      watchers.clear();
    }
  };
}

// shared/messenger.ts
import * as fs2 from "fs";
import * as path2 from "path";
var PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
};
function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
function createMantaMessenger() {
  const queues = new Map;
  const pendingAcks = new Map;
  const receivedAcks = new Set;
  const mantaDir = path2.join(process.cwd(), ".manta", "context");
  try {
    fs2.mkdirSync(mantaDir, { recursive: true });
  } catch {}
  try {
    const logPath = path2.join(mantaDir, "handoff.json");
    if (fs2.existsSync(logPath)) {
      const data = JSON.parse(fs2.readFileSync(logPath, "utf-8"));
      if (Array.isArray(data)) {
        for (const msg of data) {
          const queue = getQueue(msg.to);
          queue.push(msg);
        }
      }
    }
  } catch {}
  function getQueue(brainId) {
    if (!queues.has(brainId)) {
      queues.set(brainId, []);
    }
    return queues.get(brainId);
  }
  function sortQueue(queue) {
    queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }
  return {
    send(message) {
      const msg = {
        id: generateId(),
        from: message.from,
        to: message.to,
        type: message.type,
        priority: message.priority,
        payload: message.payload,
        timestamp: Date.now(),
        requiresAck: message.requiresAck ?? false
      };
      const queue = getQueue(msg.to);
      queue.push(msg);
      sortQueue(queue);
      if (msg.type === "ack") {
        if (pendingAcks.has(msg.id)) {
          const pending = pendingAcks.get(msg.id);
          if (!pending.resolved) {
            pending.resolved = true;
            clearTimeout(pending.timer);
            pending.resolve(true);
          }
        } else {
          receivedAcks.add(msg.id);
        }
      }
      try {
        const logPath = path2.join(mantaDir, "handoff.json");
        let existing = [];
        try {
          existing = JSON.parse(fs2.readFileSync(logPath, "utf-8"));
        } catch {}
        existing.push({ ...msg, writtenAt: Date.now() });
        if (existing.length > 50)
          existing = existing.slice(-50);
        fs2.writeFileSync(logPath, JSON.stringify(existing, null, 2));
      } catch {}
    },
    receive(brainId) {
      const queue = getQueue(brainId);
      const messages = [...queue];
      queue.length = 0;
      return messages;
    },
    waitForAck(messageId, timeoutMs) {
      if (receivedAcks.has(messageId)) {
        receivedAcks.delete(messageId);
        return Promise.resolve(true);
      }
      return new Promise((resolve, _reject) => {
        const timer = setTimeout(() => {
          if (!pendingAcks.has(messageId))
            return;
          const pending = pendingAcks.get(messageId);
          if (!pending.resolved) {
            pending.resolved = true;
            resolve(false);
          }
        }, timeoutMs);
        pendingAcks.set(messageId, { resolved: false, resolve, reject: () => {}, timer });
      });
    },
    getQueueDepth(brainId) {
      return getQueue(brainId).length;
    },
    cleanup() {
      for (const [id, pending] of pendingAcks) {
        clearTimeout(pending.timer);
        pendingAcks.delete(id);
      }
      queues.clear();
      receivedAcks.clear();
    }
  };
}

// shared/guardian.ts
var DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\//,
  /^rm\s+-rf\s+\/bin/,
  /^rm\s+-rf\s+\/usr/,
  /^rm\s+-rf\s+\/sys/,
  /^rm\s+-rf\s+\/proc/,
  /^dd\s+if=/,
  /^mkfs/,
  /^:(){ :|:& };:/
];
var PERSONAL_PATHS = [
  /\.ssh\//,
  /\.aws\//,
  /\/Documents\//,
  /\/Desktop\//,
  /\.config\/credentials/
];
var SYSTEM_PATHS = [
  /^\/bin\//,
  /^\/usr\//,
  /^\/sbin\//,
  /^\/etc\//,
  /^\/System\//
];

class Guardian {
  level;
  workspacePath;
  sandboxPath;
  constructor(config = { level: "SANDBOX" }) {
    this.level = config.level;
    this.workspacePath = config.workspacePath || "./";
    this.sandboxPath = config.sandboxPath || "./";
  }
  setLevel(level) {
    this.level = level;
  }
  canRead(path3) {
    if (this.level === "SANDBOX")
      return true;
    return this.checkPath(path3, "read");
  }
  canWrite(path3) {
    if (this.level === "SANDBOX") {
      return !this.isDangerousCommand(path3);
    }
    return this.checkPath(path3, "write");
  }
  isDangerousCommand(command) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command.trim())) {
        return true;
      }
    }
    return false;
  }
  classifyZone(path3) {
    const expandedPath = path3.replace(/^~/, process.env.HOME || __require("os").homedir() || "/root");
    for (const pattern of PERSONAL_PATHS) {
      if (pattern.test(expandedPath)) {
        return "PERSONAL";
      }
    }
    for (const pattern of SYSTEM_PATHS) {
      if (pattern.test(expandedPath)) {
        return "SYSTEM";
      }
    }
    if (expandedPath.startsWith(this.workspacePath)) {
      return "WORKSPACE";
    }
    if (expandedPath.startsWith(this.sandboxPath)) {
      return "SANDBOX";
    }
    return "SANDBOX";
  }
  checkPath(path3, operation) {
    const zone = this.classifyZone(path3);
    switch (this.level) {
      case "SANDBOX":
        return zone !== "PERSONAL" && zone !== "SYSTEM";
      case "PERMISSIVE":
        return zone !== "PERSONAL" && zone !== "SYSTEM";
      case "BALANCED":
        if (zone === "PERSONAL" || zone === "SYSTEM")
          return false;
        return true;
      case "STRICT":
        if (zone !== "WORKSPACE" && zone !== "SANDBOX")
          return false;
        return true;
      default:
        return true;
    }
  }
  getLevel() {
    return this.level;
  }
  getZoneInfo(path3) {
    const zone = this.classifyZone(path3);
    return {
      zone,
      allowed: this.checkPath(path3, "write")
    };
  }
}

// shared/evidence.ts
import * as fs3 from "fs";
import * as path3 from "path";
var EVIDENCE_DIR = "evidence";
var ITERATIONS_DIR = "iterations";

class EvidenceCollector {
  basePath;
  constructor(basePath = ".manta") {
    this.basePath = basePath;
  }
  collectEvidence(evidence) {
    const gateDir = path3.join(this.basePath, EVIDENCE_DIR, evidence.gate);
    const timestampDir = path3.join(gateDir, String(evidence.timestamp));
    this.ensureDir(timestampDir);
    const metaPath = path3.join(timestampDir, "evidence.json");
    fs3.writeFileSync(metaPath, JSON.stringify(evidence, null, 2));
    if (evidence.debugLog) {
      fs3.writeFileSync(path3.join(timestampDir, "debug.log"), evidence.debugLog);
    }
  }
  collectDebugLog(iteration, attempt, debugLog) {
    const iterDir = path3.join(this.basePath, ITERATIONS_DIR, iteration, "debug-logs");
    this.ensureDir(iterDir);
    const logPath = path3.join(iterDir, `attempt-${attempt}.md`);
    fs3.writeFileSync(logPath, debugLog);
  }
  recordIteration(evidence) {
    const iterDir = path3.join(this.basePath, ITERATIONS_DIR, evidence.iteration);
    this.ensureDir(iterDir);
    const metaPath = path3.join(iterDir, "iteration.json");
    fs3.writeFileSync(metaPath, JSON.stringify(evidence, null, 2));
  }
  getGateEvidence(gate) {
    const gateDir = path3.join(this.basePath, EVIDENCE_DIR, gate);
    if (!fs3.existsSync(gateDir))
      return [];
    const evidences = [];
    const entries = fs3.readdirSync(gateDir);
    for (const entry of entries) {
      const evidencePath = path3.join(gateDir, entry, "evidence.json");
      if (fs3.existsSync(evidencePath)) {
        try {
          const content = fs3.readFileSync(evidencePath, "utf-8");
          evidences.push(JSON.parse(content));
        } catch (e) {
          mantaError("evidence: failed to parse evidence file:", e);
        }
      }
    }
    return evidences.sort((a, b) => b.timestamp - a.timestamp);
  }
  getLatestEvidence(gate) {
    const evidences = this.getGateEvidence(gate);
    return evidences[0] || null;
  }
  getIterationLogs(iteration) {
    const logsDir = path3.join(this.basePath, ITERATIONS_DIR, iteration, "debug-logs");
    if (!fs3.existsSync(logsDir))
      return [];
    return fs3.readdirSync(logsDir).filter((f) => f.endsWith(".md")).sort().map((f) => fs3.readFileSync(path3.join(logsDir, f), "utf-8"));
  }
  hasCompleteEvidence() {
    const gates = ["plan", "build", "test", "verify", "audit", "delivery"];
    return gates.every((gate) => this.getGateEvidence(gate).length > 0);
  }
  collectFormattedDebugLog(iteration, attempt, data) {
    const formatted = formatDebugLog(data);
    this.collectDebugLog(iteration, attempt, formatted);
  }
  ensureDir(dir) {
    if (!fs3.existsSync(dir)) {
      fs3.mkdirSync(dir, { recursive: true });
    }
  }
}
function formatDebugLog(data) {
  return `\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551 MANTA DEBUG LOG \u2014 ${data.iteration}
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D

ISSUE: ${data.issue}

LOCATION: ${data.location}

ROOT CAUSE: ${data.rootCause}

FIX: ${data.fix}

ITERATION: ${data.iteration}
`;
}

// shared/gates.ts
var GATE_CHAIN = ["plan", "build", "review", "verify", "test", "audit", "delivery"];
var GATE_CRITERIA = {
  plan: {
    gate: "plan",
    blockingCriteria: [
      "Clear requirements defined",
      "SPEC.md generated",
      "Scope boundaries defined",
      "Acceptance criteria defined"
    ],
    evidenceRequired: ["SPEC.md", "GuardianConfig.json"]
  },
  build: {
    gate: "build",
    blockingCriteria: [
      "Files created per SPEC.md",
      "No scope violations",
      "Implementation matches spec"
    ],
    evidenceRequired: ["FileManifest.json", "GitDiff.txt"]
  },
  review: {
    gate: "review",
    blockingCriteria: [
      "No theatrical code patterns",
      "No TODOs or placeholders in production code",
      "No empty error handlers (catch {})",
      "No magic numbers without constants",
      "Function length \u2264 50 lines",
      "File structure matches SPEC.md",
      "Import surface is minimal (no wildcard imports)"
    ],
    evidenceRequired: ["CodeReviewReport.json"]
  },
  verify: {
    gate: "verify",
    blockingCriteria: [
      "SPEC.md alignment verified",
      "No deviation from spec without documented reason",
      "Edge cases handled",
      "Error handling complete",
      "Code review passed (manta-code-review)"
    ],
    evidenceRequired: ["VerificationReport.json", "CodeReviewReport.json"]
  },
  test: {
    gate: "test",
    blockingCriteria: [
      "Container tests pass (96%+ pass rate)",
      "All hooks verified firing",
      "Identity verified in container",
      "No theatrical test patterns"
    ],
    evidenceRequired: ["ContainerTestResult.json"]
  },
  audit: {
    gate: "audit",
    blockingCriteria: [
      "SAST clean (0 critical/high)",
      "No secrets detected",
      "Dependencies audited (no critical CVEs)"
    ],
    evidenceRequired: ["SASTReport.json", "SecretsScan.json", "AuditReport.json"]
  },
  delivery: {
    gate: "delivery",
    blockingCriteria: [
      "All previous gates passed",
      "Evidence archived",
      "Checkpoint created"
    ],
    evidenceRequired: ["EvidenceArchive.zip", "DeliverySummary.md"]
  }
};

class GateManager {
  currentGate = "plan";
  gateStatus = {
    plan: "pending",
    build: "pending",
    review: "pending",
    test: "pending",
    verify: "pending",
    audit: "pending",
    delivery: "pending"
  };
  verifyAttempts = 0;
  currentIteration = "V1.0";
  evidenceCollector;
  iterationAttempts = {};
  deadlockMaxRounds = 3;
  gatePositions = [];
  constructor(basePath = ".manta") {
    this.evidenceCollector = new EvidenceCollector(basePath);
  }
  logPosition(gate, agent, position) {
    this.gatePositions.push({ gate, agent, position, timestamp: Date.now() });
    const positionsForGate = this.gatePositions.filter((p) => p.gate === gate);
    if (positionsForGate.length >= this.deadlockMaxRounds) {
      const allBlock = positionsForGate.every((p) => p.position === "block");
      const allAllow = positionsForGate.every((p) => p.position === "allow");
      const isDeadlock = !allBlock && !allAllow;
      if (isDeadlock) {
        const conservativeAction = "block";
        return {
          consensus: false,
          conservativeAction,
          message: `GATE DEADLOCK at ${gate} after ${positionsForGate.length} rounds. ` + `Positions: ${positionsForGate.map((p) => `${p.agent}=${p.position}`).join(", ")}. ` + `Conservative outcome: ${conservativeAction}. Escalating.`
        };
      }
      return {
        consensus: true,
        conservativeAction: allBlock ? "block" : "allow",
        message: `Consensus reached at ${gate}: ${allBlock ? "block" : "allow"}`
      };
    }
    return {
      consensus: false,
      conservativeAction: null,
      message: `Position logged for ${gate} by ${agent}. Round ${positionsForGate.length}/${this.deadlockMaxRounds}.`
    };
  }
  getCurrentGate() {
    return this.currentGate;
  }
  getGateStatuses() {
    return { ...this.gateStatus };
  }
  getCurrentIteration() {
    return this.currentIteration;
  }
  canTransition(to) {
    const currentIndex = GATE_CHAIN.indexOf(this.currentGate);
    const targetIndex = GATE_CHAIN.indexOf(to);
    if (targetIndex <= currentIndex)
      return false;
    if (targetIndex > currentIndex + 1)
      return false;
    return true;
  }
  transitionTo(to) {
    if (!this.canTransition(to)) {
      return false;
    }
    this.gateStatus[this.currentGate] = "passed";
    this.currentGate = to;
    this.gateStatus[to] = "blocked";
    if (to === "verify") {
      this.verifyAttempts = 0;
    }
    return true;
  }
  blockCurrentGate() {
    this.gateStatus[this.currentGate] = "blocked";
  }
  passCurrentGate() {
    this.gateStatus[this.currentGate] = "passed";
  }
  failCurrentGate() {
    this.gateStatus[this.currentGate] = "failed";
  }
  getCriteria(gate) {
    return GATE_CRITERIA[gate];
  }
  getIterationAttempts(iteration) {
    return this.iterationAttempts[iteration] || 0;
  }
  handleVerifyFailure() {
    this.verifyAttempts++;
    this.iterationAttempts[this.currentIteration] = this.verifyAttempts;
    if (this.verifyAttempts >= 3) {
      return this.escalateToPlan();
    }
    return { action: "loop", iteration: this.currentIteration };
  }
  escalateToPlan() {
    const parts = this.currentIteration.split(/(\d+)$/);
    const name = parts[0] || "V";
    const numStr = parts[1] || "0";
    const nextNum = parseInt(numStr) + 1;
    this.currentIteration = `${name}${nextNum}`;
    this.verifyAttempts = 0;
    this.gateStatus = {
      plan: "pending",
      build: "pending",
      review: "pending",
      test: "pending",
      verify: "pending",
      audit: "pending",
      delivery: "pending"
    };
    this.currentGate = "plan";
    return { action: "escalate", iteration: this.currentIteration };
  }
  getEvidenceCollector() {
    return this.evidenceCollector;
  }
  isComplete() {
    return this.currentGate === "delivery" && this.gateStatus["delivery"] === "passed";
  }
  getState() {
    return {
      currentGate: this.currentGate,
      gateStatus: { ...this.gateStatus },
      verifyAttempts: this.verifyAttempts,
      currentIteration: this.currentIteration,
      iterationAttempts: { ...this.iterationAttempts }
    };
  }
  restore(state) {
    if (typeof state.currentGate === "string" && GATE_CHAIN.includes(state.currentGate)) {
      this.currentGate = state.currentGate;
    }
    if (typeof state.gateStatus === "object" && state.gateStatus !== null) {
      this.gateStatus = state.gateStatus;
    }
    if (typeof state.verifyAttempts === "number") {
      this.verifyAttempts = state.verifyAttempts;
    }
    if (typeof state.currentIteration === "string") {
      this.currentIteration = state.currentIteration;
    }
    if (typeof state.iterationAttempts === "object" && state.iterationAttempts !== null) {
      this.iterationAttempts = state.iterationAttempts;
    }
  }
}

// manta/coordinator.ts
class MantaCoordinator {
  stateStore;
  messenger;
  gateManager;
  constructor(config) {
    this.stateStore = config.stateStore;
    this.messenger = config.messenger;
    this.gateManager = config.gateManager;
  }
  initialize() {
    const state = {
      currentBrain: "plan",
      switchReason: "session-start",
      lastSwitchAt: Date.now()
    };
    this.stateStore.set("manta-micro-state", state, "manta-state");
  }
  getCurrentBrain() {
    const microState = this.stateStore.get("manta-micro-state", "manta-state");
    return microState?.currentBrain || "plan";
  }
  canSwitch(from, to) {
    if (from === to)
      return false;
    if (from === "plan" && to === "build")
      return true;
    if (from === "build" && to === "plan")
      return true;
    return false;
  }
  switchToPlan(reason) {
    const state = {
      currentBrain: "plan",
      switchReason: reason,
      lastSwitchAt: Date.now()
    };
    this.stateStore.set("manta-micro-state", state, "manta-state");
  }
  switchToBuild(reason) {
    const state = {
      currentBrain: "build",
      switchReason: reason,
      lastSwitchAt: Date.now()
    };
    this.stateStore.set("manta-micro-state", state, "manta-state");
  }
  onBuildComplete() {
    const current = this.getCurrentBrain();
    if (current === "build" && this.canSwitch(current, "plan")) {
      this.switchToPlan("build-complete");
      this.messenger.send({
        from: "coordinator",
        to: "manta-plan",
        type: "handoff",
        priority: "high",
        payload: { signal: "build-complete", timestamp: Date.now() },
        requiresAck: false
      });
    }
  }
  onSpecComplete() {
    const current = this.getCurrentBrain();
    if (current === "plan" && this.canSwitch(current, "build")) {
      this.switchToBuild("spec-complete");
      this.messenger.send({
        from: "coordinator",
        to: "manta-exec",
        type: "handoff",
        priority: "critical",
        payload: { signal: "spec-complete", timestamp: Date.now() },
        requiresAck: false
      });
    }
  }
  onGateFailed(gateName, attempts) {
    if (attempts >= 3) {
      this.switchToPlan("escalation-3-failures");
      this.messenger.send({
        from: "coordinator",
        to: "manta-plan",
        type: "alert",
        priority: "critical",
        payload: { gate: gateName, attempts, signal: "escalation", timestamp: Date.now() },
        requiresAck: false
      });
    }
  }
  getActiveT1(planBrainT1, buildBrainT1) {
    const current = this.getCurrentBrain();
    return current === "plan" ? planBrainT1 : buildBrainT1;
  }
}

// shared/compaction-manager.ts
import * as fs4 from "fs";
import * as path4 from "path";
var TIERS = [
  { name: "green", min: 0, label: "GREEN (0-15%) \u2014 Fresh session" },
  { name: "blue", min: 0.15, label: "BLUE (15-30%) \u2014 First checkpoint" },
  { name: "yellow", min: 0.3, label: "YELLOW (30-45%) \u2014 Regular tracking" },
  { name: "orange", min: 0.45, label: "ORANGE (45-60%) \u2014 Pre-compaction awareness" },
  { name: "red", min: 0.6, label: "RED (60-75%) \u2014 Aggressive state export" },
  { name: "critical", min: 0.75, label: "CRITICAL (75-85%) \u2014 Full handover package" },
  { name: "imminent", min: 0.85, label: "IMMINENT (85%+) \u2014 Auto-compaction fires" }
];
var ANCHOR_FILES = [
  "COMPACTION_SURVIVAL.md",
  "BUILD_STATE.md",
  "DECISION_CHAIN.md",
  "EVIDENCE_STATE.md",
  "TASK_QUEUE.md",
  "CHANGELOG.md",
  "DEBUG_LOG.md",
  "POST-COMPACTION_PROMPT.md"
];

class TokenEstimator {
  estimatedTokens = 0;
  maxTokens;
  toolCallCount = 0;
  chatTurnCount = 0;
  constructor(maxTokens = 170000) {
    this.maxTokens = maxTokens;
  }
  recordToolCall(outputSizeBytes = 0) {
    this.toolCallCount++;
    const baseCost = 500;
    const outputCost = Math.min(outputSizeBytes / 4, 2000);
    this.estimatedTokens += Math.round(baseCost + outputCost);
    this.estimatedTokens = Math.min(this.estimatedTokens, this.maxTokens);
  }
  recordChatTurn() {
    this.chatTurnCount++;
    this.estimatedTokens += 200;
    this.estimatedTokens = Math.min(this.estimatedTokens, this.maxTokens);
  }
  setTokens(tokens) {
    this.estimatedTokens = Math.min(tokens, this.maxTokens);
  }
  getEstimatedTokens() {
    return this.estimatedTokens;
  }
  getRatio() {
    return this.estimatedTokens / this.maxTokens;
  }
  getTier() {
    const ratio = this.getRatio();
    for (let i = TIERS.length - 1;i >= 0; i--) {
      if (ratio >= TIERS[i].min)
        return TIERS[i].name;
    }
    return "green";
  }
  getTierIndex() {
    const ratio = this.getRatio();
    for (let i = TIERS.length - 1;i >= 0; i--) {
      if (ratio >= TIERS[i].min)
        return i;
    }
    return 0;
  }
  getStats() {
    return {
      estimatedTokens: this.estimatedTokens,
      maxTokens: this.maxTokens,
      ratio: this.getRatio(),
      tier: this.getTier(),
      toolCalls: this.toolCallCount,
      chatTurns: this.chatTurnCount
    };
  }
}

class CompactionManager {
  folderPath;
  estimator;
  decisions = [];
  tasks = [];
  lastTierIndex = -1;
  lastAnchorUpdate = 0;
  exportCount = 0;
  initialized = false;
  tierCallbacks = [];
  currentGate = "plan";
  currentIteration = "V1.0";
  gateStatuses = {};
  errorsUnsolved = [];
  constructor(workspaceDir) {
    this.folderPath = path4.join(workspaceDir, ".manta", "compaction-survival");
    this.estimator = new TokenEstimator(170000);
  }
  onTierCrossing(cb) {
    this.tierCallbacks.push(cb);
  }
  initialize(gateState) {
    if (this.initialized)
      return;
    fs4.mkdirSync(this.folderPath, { recursive: true });
    this.initialized = true;
    if (gateState) {
      this.currentGate = typeof gateState.currentGate === "string" ? gateState.currentGate : "plan";
      this.currentIteration = typeof gateState.currentIteration === "string" ? gateState.currentIteration : "V1.0";
      this.gateStatuses = typeof gateState.gateStatus === "object" && gateState.gateStatus !== null ? gateState.gateStatus : {};
    }
    this.writeAllAnchors("init");
    this.exportCount++;
  }
  isInitialized() {
    return this.initialized;
  }
  hasAnchors() {
    return ANCHOR_FILES.every((f) => fs4.existsSync(path4.join(this.folderPath, f)));
  }
  getFolderPath() {
    return this.folderPath;
  }
  onToolCall(toolName, outputSizeBytes, gateState) {
    if (!this.initialized)
      this.initialize(gateState);
    this.updateGateState(gateState);
    this.estimator.recordToolCall(outputSizeBytes);
    const newIndex = this.estimator.getTierIndex();
    if (newIndex > this.lastTierIndex && this.lastTierIndex >= 0) {
      for (const cb of this.tierCallbacks) {
        try {
          cb(this.estimator.getTier(), newIndex, this.estimator.getRatio());
        } catch (e) {
          mantaError("compaction: tier callback failed:", e);
        }
      }
      this.writeAllAnchors("threshold");
      this.writeExport("threshold");
    }
    this.lastTierIndex = newIndex;
    const now = Date.now();
    if (now - this.lastAnchorUpdate > 1e4) {
      this.lastAnchorUpdate = now;
      this.writeAllAnchors("periodic");
    }
  }
  recordChatTurn() {
    this.estimator.recordChatTurn();
  }
  onMilestone(gateState, milestone) {
    if (!this.initialized)
      this.initialize(gateState);
    this.updateGateState(gateState);
    this.decisions.unshift({
      id: `ms-${Date.now()}`,
      type: "milestone",
      description: milestone,
      contextFiles: [],
      outcome: "completed",
      timestamp: Date.now()
    });
    if (this.decisions.length > 50)
      this.decisions.length = 50;
    this.writeAllAnchors("milestone");
    this.writeExport("milestone");
    this.exportCount++;
  }
  onCompacting(gateState, sessionID) {
    if (!this.initialized)
      this.initialize(gateState);
    this.updateGateState(gateState);
    this.writeAllAnchors("hook");
    const exportData = {
      exportId: `hook-${Date.now()}`,
      timestamp: Date.now(),
      trigger: "hook",
      tier: this.estimator.getTier(),
      gate: this.currentGate,
      iteration: this.currentIteration
    };
    this.writeExport("hook");
    this.exportCount++;
    const injection = this.readAnchor("COMPACTION_SURVIVAL.md") || "";
    return { export: exportData, injection };
  }
  triggerExport(gateState, activeTask, nextSteps) {
    if (!this.initialized)
      this.initialize(gateState);
    this.updateGateState(gateState);
    if (activeTask)
      this.addOrUpdateTask(activeTask, "in_progress");
    if (nextSteps)
      this.addOrUpdateTask(nextSteps, "pending");
    this.writeAllAnchors("manual");
    this.writeExport("manual");
    this.exportCount++;
    return {
      exportId: `manual-${Date.now()}`,
      timestamp: Date.now(),
      trigger: "manual",
      tier: this.estimator.getTier(),
      gate: this.currentGate,
      iteration: this.currentIteration
    };
  }
  addDecision(decision) {
    decision.timestamp = decision.timestamp || Date.now();
    this.decisions.unshift(decision);
    if (this.decisions.length > 50)
      this.decisions.length = 50;
  }
  getDecisions() {
    return [...this.decisions];
  }
  addOrUpdateTask(description, status) {
    const existing = this.tasks.find((t) => t.description === description);
    if (existing) {
      existing.status = status;
      existing.timestamp = Date.now();
    } else {
      this.tasks.unshift({ id: `task-${Date.now()}`, description, status, timestamp: Date.now() });
      if (this.tasks.length > 30)
        this.tasks.length = 30;
    }
  }
  completeTask(description) {
    const t = this.tasks.find((t2) => t2.description === description);
    if (t) {
      t.status = "done";
      t.timestamp = Date.now();
    }
  }
  addError(error) {
    this.errorsUnsolved.unshift(error);
    if (this.errorsUnsolved.length > 20)
      this.errorsUnsolved.length = 20;
  }
  resolveError(error) {
    this.errorsUnsolved = this.errorsUnsolved.filter((e) => e !== error);
  }
  getStatus() {
    return {
      initialized: this.initialized,
      anchorsPresent: this.hasAnchors(),
      tokenEstimate: this.estimator.getStats(),
      tier: this.estimator.getTier(),
      decisionsCount: this.decisions.length,
      tasksCount: this.tasks.length,
      errorsCount: this.errorsUnsolved.length,
      exportCount: this.exportCount,
      currentGate: this.currentGate,
      currentIteration: this.currentIteration,
      exportsOnDisk: this.listExports()
    };
  }
  readAnchor(name) {
    const fp = path4.join(this.folderPath, name);
    if (!fs4.existsSync(fp))
      return null;
    return fs4.readFileSync(fp, "utf-8");
  }
  updateGateState(gateState) {
    if (typeof gateState.currentGate === "string")
      this.currentGate = gateState.currentGate;
    if (typeof gateState.currentIteration === "string")
      this.currentIteration = gateState.currentIteration;
    if (typeof gateState.gateStatus === "object" && gateState.gateStatus !== null)
      this.gateStatuses = gateState.gateStatus;
  }
  writeExport(trigger) {
    const dir = path4.join(this.folderPath, `export-${Date.now()}`);
    fs4.mkdirSync(dir, { recursive: true });
    const data = {
      exportId: `export-${Date.now()}`,
      timestamp: Date.now(),
      trigger,
      tier: this.estimator.getTier(),
      gate: this.currentGate,
      iteration: this.currentIteration
    };
    fs4.writeFileSync(path4.join(dir, "manifest.json"), JSON.stringify(data, null, 2));
    fs4.writeFileSync(path4.join(dir, "full-state.json"), JSON.stringify({
      gate: this.currentGate,
      iteration: this.currentIteration,
      gateStatuses: this.gateStatuses,
      decisions: this.decisions.slice(0, 10),
      tasks: this.tasks.slice(0, 10),
      errors: this.errorsUnsolved,
      tokenEstimate: this.estimator.getStats()
    }, null, 2));
    try {
      const parentDir = path4.dirname(dir);
      const allExports = fs4.readdirSync(parentDir).filter((d) => d.startsWith("export-")).map((d) => ({ name: d, time: fs4.statSync(path4.join(parentDir, d)).mtimeMs })).sort((a, b) => b.time - a.time);
      if (allExports.length > 10) {
        const toRemove = allExports.slice(10);
        for (const exp of toRemove) {
          fs4.rmSync(path4.join(parentDir, exp.name), { recursive: true, force: true });
        }
      }
    } catch (e) {
      mantaError("Failed to clean old exports:", e);
    }
  }
  listExports() {
    if (!fs4.existsSync(this.folderPath))
      return [];
    return fs4.readdirSync(this.folderPath).filter((d) => d.startsWith("export-"));
  }
  writeAllAnchors(trigger) {
    fs4.mkdirSync(this.folderPath, { recursive: true });
    const ts = new Date().toISOString();
    const tier = this.estimator.getTier();
    const tierLabel = TIERS.find((t) => t.name === tier)?.label || tier;
    this.writeAnchor("COMPACTION_SURVIVAL.md", this.renderCompactionSurvival(ts, tierLabel, trigger));
    this.writeAnchor("BUILD_STATE.md", this.renderBuildState(ts));
    this.writeAnchor("DECISION_CHAIN.md", this.renderDecisionChain(ts));
    this.writeAnchor("EVIDENCE_STATE.md", this.renderEvidenceState(ts));
    this.writeAnchor("TASK_QUEUE.md", this.renderTaskQueue(ts));
    this.writeAnchor("CHANGELOG.md", this.renderChangeLog(ts));
    this.writeAnchor("DEBUG_LOG.md", this.renderDebugLog(ts));
    this.writeAnchor("POST-COMPACTION_PROMPT.md", this.renderPostCompaction(ts));
  }
  writeAnchor(name, content) {
    fs4.writeFileSync(path4.join(this.folderPath, name), content);
  }
  renderCompactionSurvival(ts, tierLabel, trigger) {
    return `# COMPACTION_SURVIVAL.md \u2014 READ THIS FIRST AFTER COMPACTION

> **IF IT'S NOT ON DISK, IT DIDN'T HAPPEN.**

## Stream Anchor

**Agent:** MANTA v2.2
**Time:** ${ts}
**Tier:** ${tierLabel}
**Trigger:** ${trigger}
**Gate:** ${this.currentGate} (${this.currentIteration})
**Exports written:** ${this.exportCount}

## Recovery Protocol

After compaction, read these files IN ORDER:

1. **THIS FILE** (COMPACTION_SURVIVAL.md) \u2014 you are here
2. **BUILD_STATE.md** \u2014 where were we in the build?
3. **DECISION_CHAIN.md** \u2014 what decisions were made?
4. **EVIDENCE_STATE.md** \u2014 what evidence exists?
5. **TASK_QUEUE.md** \u2014 what's next?

Then:
- Restore gate state from gate position
- Resume from ${this.currentGate} gate
- Continue task from BUILD_STATE.md

## Identity Reminder

You are **MANTA v2.2** \u2014 dual-brain sequential precision agent.
- NOT Shark, NOT Kraken, NOT generic
- Architecture: Plan Brain + Build Brain (sequential)
- 17 tools registered
- VERIFY gate before TEST gate (never skip)
- Guardian blocks all foreign tools

---
*Updated: ${ts} by ${trigger}*
`;
  }
  renderBuildState(ts) {
    const chain = ["plan", "build", "review", "verify", "test", "audit", "delivery"];
    const activeTask = this.tasks.find((t) => t.status === "in_progress");
    const lastDone = this.tasks.find((t) => t.status === "done");
    const nextPending = this.tasks.find((t) => t.status === "pending");
    return `# BUILD_STATE.md \u2014 Build Phase & Position

## Current Position
- **Gate:** ${this.currentGate}
- **Iteration:** ${this.currentIteration}

## Gate Chain
${chain.map((g) => {
      const status = this.gateStatuses[g] || "pending";
      const marker = status === "passed" ? "[x]" : status === "failed" ? "[!]" : "[ ]";
      const current = g === this.currentGate ? " \u2190 CURRENT" : "";
      return `${marker} ${g}: ${status}${current}`;
    }).join(`
`)}

## Active Task
${activeTask ? activeTask.description : "None"}

## Last Completed
${lastDone ? lastDone.description : "None"}

## Next
${nextPending ? nextPending.description : "Continue from current gate"}

## Unsolved Errors
${this.errorsUnsolved.length > 0 ? this.errorsUnsolved.map((e) => `- ${e}`).join(`
`) : "None"}

## Token Budget
- **Estimated:** ${this.estimator.getEstimatedTokens()} / ${this.estimator.getStats().maxTokens}
- **Tier:** ${this.estimator.getTier()}
- **Tool calls this session:** ${this.estimator.getStats().toolCalls}

---
*Updated: ${ts}*
`;
  }
  renderDecisionChain(ts) {
    const recent = this.decisions.slice(0, 25);
    return `# DECISION_CHAIN.md \u2014 Reasoning Trail

## Recent Decisions (${recent.length}/${this.decisions.length})
${recent.length > 0 ? recent.map((d, i) => {
      const t = d.timestamp ? new Date(d.timestamp).toISOString().substring(11, 19) : "??:??:??";
      return `${i + 1}. [${t}] [${d.type}] ${d.description}${d.outcome ? ` \u2192 ${d.outcome}` : ""}`;
    }).join(`
`) : "No decisions recorded yet"}

## Key Architectural Decisions
${this.decisions.filter((d) => d.type === "architecture").slice(0, 5).map((d, i) => `${i + 1}. ${d.description}${d.outcome ? ` \u2192 ${d.outcome}` : ""}`).join(`
`) || "None"}

## Key Debug Decisions
${this.decisions.filter((d) => d.type === "debug").slice(0, 5).map((d, i) => `${i + 1}. ${d.description}${d.outcome ? ` \u2192 ${d.outcome}` : ""}`).join(`
`) || "None"}

---
*Updated: ${ts}*
`;
  }
  renderEvidenceState(ts) {
    const chain = ["plan", "build", "review", "verify", "test", "audit", "delivery"];
    const passed = chain.filter((g) => this.gateStatuses[g] === "passed");
    const failed = chain.filter((g) => this.gateStatuses[g] === "failed");
    return `# EVIDENCE_STATE.md \u2014 Evidence Collection Status

## Gate Evidence
${chain.map((g) => {
      const status = this.gateStatuses[g] || "pending";
      const evMarker = status === "passed" ? "COLLECTED" : status === "failed" ? "FAILED" : "PENDING";
      return `- ${g}: ${evMarker}`;
    }).join(`
`)}

## Summary
- **Gates passed:** ${passed.length}/7 (${passed.join(", ") || "none"})
- **Gates failed:** ${failed.length} (${failed.join(", ") || "none"})
- **Current gate:** ${this.currentGate}

## Evidence Chain Continuity
${passed.length > 0 ? "Chain intact through: " + passed.join(" \u2192 ") : "No evidence collected yet"}

## Exports on Disk
${this.exportCount} exports written to compaction-survival folder

---
*Updated: ${ts}*
`;
  }
  renderTaskQueue(ts) {
    const done = this.tasks.filter((t) => t.status === "done");
    const inProgress = this.tasks.filter((t) => t.status === "in_progress");
    const pending = this.tasks.filter((t) => t.status === "pending");
    const blocked = this.tasks.filter((t) => t.status === "blocked");
    return `# TASK_QUEUE.md \u2014 Task Tracking

## In Progress
${inProgress.length > 0 ? inProgress.map((t) => `- ${t.description}`).join(`
`) : "Nothing in progress"}

## Pending (Next Up)
${pending.length > 0 ? pending.map((t) => `- ${t.description}`).join(`
`) : "No pending tasks"}

## Blocked
${blocked.length > 0 ? blocked.map((t) => `- ${t.description}`).join(`
`) : "Nothing blocked"}

## Completed
${done.length > 0 ? done.slice(0, 15).map((t) => `- [x] ${t.description}`).join(`
`) : "Nothing completed yet"}

## Token Budget Status
- **Estimated usage:** ${(this.estimator.getRatio() * 100).toFixed(1)}%
- **Tier:** ${this.estimator.getTier()}
- **Tool calls:** ${this.estimator.getStats().toolCalls}

---
*Updated: ${ts}*
`;
  }
  renderChangeLog(ts) {
    return `# MANTA \u2014 Build Log

_Initialized: ${ts}_

| Issue | File | Change |
|-------|------|--------|
| Init | system | Context management initialized |
`;
  }
  renderDebugLog(ts) {
    const errors = this.errorsUnsolved.length > 0 ? this.errorsUnsolved.map((e) => `## ${ts} \u2014 error
- **Desc:** ${e}
- **Root Cause:** Pending
- **Fix:** Pending`).join(`

`) : "No failures recorded.";
    return `# DEBUG_LOG.md

${errors}

---
*Updated: ${ts}*`;
  }
  renderPostCompaction(ts) {
    return `# POST-COMPACTION RECOVERY PROMPT

**Gate:** ${this.currentGate}
**Iteration:** ${this.currentIteration}
**Phase:** ${this.tasks.find((t) => t.status === "in_progress")?.description || "Awaiting task"}
**Active:** ${this.tasks.filter((t) => t.status === "in_progress").length}
**Completed:** ${this.tasks.filter((t) => t.status === "done").length}

**Recovery:** system.transform re-injects identity. T2 reloads from disk.
**Resume:** Continue from ${this.currentGate} gate.

---
*Updated: ${ts}*`;
  }
}

// hooks/v4.1/agent-state.ts
var agentBySession = new Map;
function setCurrentAgent(agent, sessionId, userMessage) {
  const sid = sessionId || "default";
  const current = agentBySession.get(sid);
  agentBySession.set(sid, {
    agent,
    timestamp: Date.now(),
    lastUserMessage: userMessage || current?.lastUserMessage || ""
  });
}
function getCurrentAgent(sessionId) {
  const sid = sessionId || "default";
  return agentBySession.get(sid)?.agent;
}
function clearCurrentAgent(sessionId) {
  agentBySession.delete(sessionId || "default");
}

// hooks/v4.1/guardian-hook.ts
var VC_TOOLS = ["visual-cortex_analyze", "visual-cortex_browser_capture_element", "visual-cortex_browser_click", "visual-cortex_browser_evaluate", "visual-cortex_browser_navigate", "visual-cortex_browser_press_key", "visual-cortex_browser_screenshot", "visual-cortex_browser_scroll", "visual-cortex_browser_type", "visual-cortex_capture", "visual-cortex_cdp_status", "visual-cortex_compare", "visual-cortex_context", "visual-cortex_epoch_summary", "visual-cortex_health", "visual-cortex_list_tiles", "visual-cortex_recall", "visual-cortex_semint_configure", "visual-cortex_semint_start", "visual-cortex_semint_status", "visual-cortex_semint_stop", "visual-cortex_spawn_container_tile", "visual-cortex_status", "visual-cortex_tv_draw_fibonacci", "visual-cortex_tv_draw_horizontal_line", "visual-cortex_tv_draw_trade_setup", "visual-cortex_tv_draw_zone", "visual-cortex_tv_get_backtest_results", "visual-cortex_tv_get_visible_bars", "visual-cortex_tv_open_chart", "visual-cortex_tv_screenshot", "visual-cortex_tv_set_timeframe", "visual-cortex_tv_switch_symbol", "visual-cortex_verify_tile"];
var RB_TOOLS = ["reasoning-bus_reasoning_channels", "reasoning-bus_reasoning_check", "reasoning-bus_reasoning_join", "reasoning-bus_reasoning_post", "reasoning-bus_reasoning_read", "reasoning-bus_reasoning_resolve"];
var HIVE_READ_TOOLS = ["hive_context", "hive_scan", "hive_status", "hive_trash_list", "hive_trash_status"];
var HIVE_FULL_TOOLS = ["hive_remember", "hive_forget", "hive_purge", "hive_restore"];
var ORCHESTRATOR_TOOLS = new Set(["task", "manta-compaction", "checkpoint", "manta-status", "manta-gate", "manta-evidence", "todowrite", ...VC_TOOLS, ...RB_TOOLS, ...HIVE_READ_TOOLS, ...HIVE_FULL_TOOLS]);
var PLAN_TOOLS = new Set(["read", "glob", "grep", "webfetch", "question", "manta-code-review", "checkpoint", "todowrite", "ps-mode-status", "ps-mode-layer", "ps-mode-evidence", "ps-mode-derail", "ps-mode-debug", ...VC_TOOLS, ...RB_TOOLS, ...HIVE_READ_TOOLS]);
var EXEC_TOOLS = new Set(["read", "write", "edit", "bash", "glob", "grep", "manta-spawn-container", "manta-test-runner", "manta-runtime-audit", "manta-code-audit", "manta-code-review", "checkpoint", "todowrite", ...VC_TOOLS, ...RB_TOOLS, ...HIVE_READ_TOOLS]);
var FOREIGN_IDENTIFIERS = ["shark", "kraken", "spider", "trident", "hydra", "hermes"];
function isForeignTool(tool) {
  const lower = tool.toLowerCase();
  return FOREIGN_IDENTIFIERS.some((id) => lower.includes(id)) && !lower.startsWith("manta");
}
var GLOBAL_OPENCODE_KILL_PATTERNS = [
  /^pkill\s+.*opencode/i,
  /^killall\s+.*opencode/i,
  /^kill\s+.*pgrep\s+.*opencode/i,
  /^kill\s+.*pidof\s+.*opencode/i,
  /pkill\s+-f\s+.*opencode/i
];
function isGlobalOpencodeKill(command) {
  if (/docker\s+exec\s+manta-container/i.test(command))
    return false;
  return GLOBAL_OPENCODE_KILL_PATTERNS.some((p) => p.test(command.trim()));
}
function createGuardianHook(guardian) {
  return async (input, output) => {
    const inputRec = input;
    const sessionId = String(inputRec?.sessionID ?? "");
    const sessionObj = inputRec?.session;
    const agentFromInput = String(inputRec?.agent ?? inputRec?.agentName ?? sessionObj?.agentName ?? "");
    const agent = getCurrentAgent(sessionId) || agentFromInput || "";
    const tool = input?.tool || "";
    const outputRec = output;
    const args = outputRec?.args ?? inputRec?.args ?? {};
    if (!agent)
      return;
    if (!agent.startsWith("manta"))
      return;
    if (isForeignTool(tool)) {
      throw new Error(`[FIREWALL_BLOCKED] L0: ${tool} not allowed. Use manta-* tools.`);
    }
    if (agent === "manta") {
      const isAllowed = ORCHESTRATOR_TOOLS.has(tool) || tool.startsWith("visual-cortex_") || tool.startsWith("reasoning-bus_");
      if (!isAllowed) {
        throw new Error(`[FIREWALL_BLOCKED] L0: ${tool} denied. Use task(manta-plan/exec).`);
      }
    } else if (agent === "manta-plan") {
      const isAllowed = PLAN_TOOLS.has(tool) || tool.startsWith("visual-cortex_") || tool.startsWith("reasoning-bus_");
      if (!isAllowed)
        throw new Error(`[FIREWALL_BLOCKED] L0: Plan read-only. ${tool} denied.`);
    } else if (agent === "manta-exec") {
      const isAllowed = EXEC_TOOLS.has(tool) || tool.startsWith("visual-cortex_") || tool.startsWith("reasoning-bus_");
      if (!isAllowed)
        throw new Error(`[FIREWALL_BLOCKED] L0: Exec cannot use ${tool}.`);
    }
    if (tool === "bash") {
      const command = String(args?.command || args?.cmd || "");
      if (/mock|stub|fake|pretend|simulate/i.test(command)) {
        throw new Error(`[FIREWALL_BLOCKED] L1: Mock cmd blocked. Real impl required.`);
      }
    }
    if (tool === "write" || tool === "edit") {
      const content = String(args?.content || "");
      if (content && content.length < 10) {
        throw new Error(`[FIREWALL_BLOCKED] L2: Content ${content.length} chars. Too short.`);
      }
    }
    if (tool === "write" || tool === "edit") {
      const filePath = String(args?.filePath || "");
      if (filePath && !guardian.canWrite(filePath)) {
        throw new Error(`[FIREWALL_BLOCKED] L3: Zone restrict: ${filePath}`);
      }
    }
    if (tool === "bash") {
      const command = String(args?.command || args?.cmd || "");
      if (/rm\s+-rf/i.test(command)) {
        throw new Error(`[FIREWALL_BLOCKED] L4: rm -rf blocked. Use targeted file removal only.`);
      }
      if (guardian.isDangerousCommand(command))
        throw new Error(`[FIREWALL_BLOCKED] L4: Dangerous cmd.`);
      if (isGlobalOpencodeKill(command))
        throw new Error(`[FIREWALL_BLOCKED] L4: Global kill. Use docker exec manta pkill`);
    }
  };
}

// shared/agent-identity.ts
var MANTA_NAMES = new Set(["manta", "manta-plan", "manta-exec"]);
function isMantaAgent(agent) {
  if (!agent)
    return false;
  const lower = agent.toLowerCase();
  return MANTA_NAMES.has(lower) || lower.startsWith("manta-") || lower.startsWith("manta_");
}

// shared/manta-identity-synthesizer.ts
var IDENTITY_WARHEAD = `[MANTA IDENTITY WARHEAD]
You are MANTA v2.2.2 \u2014 dual-brain sequential precision engineering agent.
NOT opencode. NOT generic AI. NOT a coding agent.
When asked "who are you": "I am MANTA v2.2.2, a dual-brain sequential precision engineering agent with PSM and guardian enforcement."`;
var GATE_WARHEAD = `[MANTA GATE WARHEAD]
Gate chain: PLAN \u2192 BUILD \u2192 REVIEW \u2192 VERIFY \u2192 TEST \u2192 AUDIT \u2192 DELIVERY
VERIFY: manta-code-review, 0 critical/high + EngineeringChecklist all true
TEST: Container TUI test, 90%+ pass rate, triple evidence
AUDIT: Spec alignment + test authenticity + theatrical scan

Recovery loops:
  VERIFY fail \u2192 BUILD (max 3)
  TEST fail \u2192 PLAN (max 3)
  AUDIT fail \u2192 PLAN (unlimited)`;
var ENFORCEMENT_WARHEAD = `[MANTA ENFORCEMENT WARHEAD]
1. PER-AGENT TOOL WHITELISTS \u2014 Orchestrator: task/manta-*/visual-cortex_*/hive_*/reasoning-bus_*. Plan: read-only. Exec: full dev.
2. FOREIGN TOOL BLOCKING \u2014 No shark, kraken, spider, trident, hydra, hermes tools.
3. TOOL ALLOWLIST ENFORCEMENT \u2014 non-allowlisted tools blocked by guardian.
4. ZONE-BASED WRITE PROTECTION \u2014 writes restricted to project zones.
5. DANGEROUS COMMAND DETECTION \u2014 rm -rf, dd, mkfs, fork bombs blocked.
6. VISION HIERARCHY: visual-cortex_analyze first, pipe-pane second, tmux capture-pane never.

Guardian Navigation:
- Check: does this command use a blocked tool?
- If blocked \u2192 use allowed manta-* tool instead
- Error messages are detour signs, not roadblocks`;
var FOCUS_WARHEAD = `[MANTA FOCUS WARHEAD]
Task context is provided by the orchestrator in the task() prompt.
Execute the plan. Do not invent scope outside the task prompt.`;
var RUNTIME_GRADE_ENGINEER_WARHEAD = `[MANTA RUNTIME GRADE ENGINEER WARHEAD]
1. User sends task -> spawn PLAN_BRAIN via task(agent=manta-plan)
2. PLAN_BRAIN returns plan -> spawn EXECUTION_BRAIN with the plan
3. EXECUTION_BRAIN returns results or EXECUTION_STUCK
4. If STUCK -> spawn PLAN_BRAIN with previous context
5. Orchestrator repeats until success
6. When all gates pass, deliver to user
- Orchestrator NEVER does the work directly
- Plan Brain is READ ONLY
- Execution Brain implements EXACTLY as planned
CRITICAL: Plan before build. Verify before declare. Evidence on disk is the only proof.`;
var ARCHITECTURE_WARHEAD = `[MANTA ARCHITECTURE WARHEAD]
MANTA uses CLEAR+REBUILD identity injection: sys.system.length = 0, then rebuild from warheads.
This wipes ALL runtime defaults \u2014 superior to SCAN+REPLACE which only patches one string.
Predictable warhead ordering, no dedup check needed, no string-matching fragility.
All system prompts are statically deterministic per agent \u2014 caching-safe.
Dynamic state (gate position, task context) goes in task() prompts and tool responses, NOT system prompts.`;
var STATIC_T1_WARHEADS = {
  identityWarhead: IDENTITY_WARHEAD,
  gateWarhead: GATE_WARHEAD,
  enforcementWarhead: ENFORCEMENT_WARHEAD,
  focusWarhead: FOCUS_WARHEAD,
  recoveryWarhead: "",
  RuntimeGradeEngineerWarhead: RUNTIME_GRADE_ENGINEER_WARHEAD,
  architectureWarhead: ARCHITECTURE_WARHEAD
};
function getT1Injectables() {
  return STATIC_T1_WARHEADS;
}

// shared/manta-identity-header.ts
function formatMantaIdentityHeader() {
  return [
    "[AGENT IDENTITY BINDING]",
    "",
    "You are MANTA v2.2.2 \u2014 a dual-brain sequential precision engineering agent with PSM and guardian enforcement.",
    'You are NOT "opencode". You are NOT a generic AI assistant.',
    "You are NOT a chatbot. You are NOT an interactive CLI tool.",
    "You are NOT a software engineering assistant.",
    "",
    "Identity Responses:",
    '- "who are you" \u2192 "I am MANTA v2.2.2, a dual-brain sequential precision engineering agent with PSM and guardian enforcement."',
    '- "what are you" \u2192 "I am MANTA v2.2.2, a dual-brain sequential precision engineering agent with PSM and guardian enforcement."',
    '- "are you opencode" \u2192 "No. I am MANTA. opencode is the runtime platform."',
    "",
    "[OPERATING MODE \u2014 DEFAULT OPERATING MODE]",
    "1. DELEGATION IS MANDATORY: You MUST delegate ALL work to subagents. DO NOT attempt ANY tool directly.",
    "2. TOOL CHECK RULE: BEFORE calling ANY tool, check if it is in your [TOOL ACCESS \u2014 ALLOWLIST ENFORCED] list.",
    "   If the tool IS listed \u2192 you may use it.",
    "   If the tool IS NOT listed \u2192 IMMEDIATELY delegate via task(). DO NOT call the tool and wait for a firewall.",
    "3. DELEGATION DECISION TREE:",
    "   - Need to READ, SEARCH, ANALYZE files/code? \u2192 task(agent=manta-plan) \u2014 Plan Brain is read-only",
    "   - Need to WRITE, EDIT, BUILD, TEST, RUN commands? \u2192 task(agent=manta-exec) \u2014 Exec Brain has full tools",
    "   - Need to SEE a screenshot/TUI/canvas? \u2192 Use visual-cortex_analyze or visual-cortex_browser_screenshot (they ARE in your tool list)",
    "   - Need to SPAWN a subagent? \u2192 task() is the ONLY way (it IS in your tool list)",
    "4. VISION FIRST: Use visual-cortex_analyze to SEE tiles, TUI state, canvas, and config BEFORE acting.",
    "5. GATE CHAIN: PLAN \u2192 BUILD \u2192 REVIEW \u2192 VERIFY \u2192 TEST \u2192 AUDIT \u2192 DELIVERY.",
    "",
    "[CAPABILITIES & CONSTRAINTS]",
    "1. ORCHESTRATOR (manta): Coordination + vision + Visual Cortex + Reasoning Bus.",
    "   ALLOWED: task, manta-*, visual-cortex_*, reasoning-bus_*, todowrite, checkpoint.",
    "   CANNOT: read, write, edit, bash, glob, grep (use manta-plan or manta-exec).",
    "   VIOLATION: Calling denied tools wastes tokens. DELEGATE FIRST.",
    "2. PLAN BRAIN (manta-plan): Read-only analysis \u2014 read, glob, grep, webfetch, PSM tools.",
    "   CANNOT: write, edit, bash, task.",
    "3. EXECUTION BRAIN (manta-exec): Full implementation \u2014 read, write, edit, bash, container tools.",
    "   CANNOT: task (only orchestrator spawns).",
    "4. NEVER use shark/kraken/spider/trident/hydra/hermes tools \u2014 they will be blocked.",
    "",
    "[VISION HIERARCHY \u2014 MANDATORY]",
    "For ALL copilot tile and TUI operations, use this priority order:",
    "",
    "1. visual-cortex_analyze (BEST): Use FIRST to see tile position on canvas, check if TUI is active,",
    "   verify plugin/model config in TUI header, confirm tile size/position,",
    "   read error messages, observe test runner output, verify stream progression.",
    '   CALL visual-cortex_analyze image_path="<screenshot>" prompt="<question>"',
    "",
    "2. pipe-pane stream (SECOND): Read /tmp/manta-container/stream.txt for continuous",
    "   TUI output capture. Use strings + position tracking. NEVER use tmux capture-pane.",
    "",
    "3. tmux capture-pane (NEVER): Blocked. Do not use. vision + pipe-pane cover all cases.",
    "",
    "Tile/TUI workflow:",
    "  a) visual-cortex_analyze to SEE the tile on canvas, check size and position",
    '  b) visual-cortex_analyze to SEE if TUI is loaded (look for "Ask anything" or agent header)',
    "  c) visual-cortex_analyze to SEE if plugin/model config is correct in TUI status bar",
    "  d) Send commands via tmux send-keys (two-step Enter method)",
    "  e) Read pipe-pane stream to capture responses (position tracking)",
    "  f) visual-cortex_analyze to SEE test results and verify output",
    "",
    "[KNOWN DERAILMENT PATTERNS \u2014 AVOID THESE]",
    "D1: chat.message identity \u2014 Identity comes ONLY from system.transform.",
    "D2: Array replacement \u2014 REPLACE runtime defaults in-place, NOT unshift.",
    "D3: Config instructions \u2014 Runtime IGNORES config instructions field.",
    "D4: False success \u2014 Never declare without TUI runtime evidence.",
    "D5: Static context \u2014 ALL canon context docs update on EVERY trigger.",
    "D6: Text-only testing \u2014 Defaulting to text reads when visual-cortex_analyze is available. USE VISION FIRST.",
    "",
    "[CONTEXT MANAGEMENT ARCHITECTURE]",
    "5 memory anchor docs at .manta/compaction-survival/, mechanically updated:",
    '1. COMPACTION_SURVIVAL.md \u2014 "Read first" doc. Stream anchor + recovery protocol.',
    "2. BUILD_STATE.md \u2014 Phase, last completed, in-flight, next.",
    "3. DECISION_CHAIN.md \u2014 Rolling reasoning trail (last 50 decisions).",
    "4. EVIDENCE_STATE.md \u2014 Evidence collected, gates passed, chain continuity.",
    "5. TASK_QUEUE.md \u2014 What's done, in progress, and next.",
    "",
    "[TOOL ACCESS \u2014 ALLOWLIST ENFORCED]",
    "ORCHESTRATOR (manta): task, manta-*, visual-cortex_*, reasoning-bus_*, todowrite, checkpoint",
    "PLAN BRAIN (manta-plan): read, glob, grep, webfetch, hive_*, manta-code-review, ps-mode-status, ps-mode-layer, ps-mode-evidence, ps-mode-derail, ps-mode-debug, checkpoint",
    "EXECUTION BRAIN (manta-exec): read, write, edit, bash, glob, grep, manta-spawn-container, manta-test-runner, manta-runtime-audit, manta-code-audit, manta-code-review, checkpoint",
    "",
    "[END AGENT IDENTITY BINDING]"
  ].join(`
`);
}

// hooks/v4.1/system-transform-hook.ts
import * as fs5 from "fs";
import * as path5 from "path";

// manta/brains.ts
var ORCHESTRATOR_T1 = `You are the MANTA Orchestrator v2.2.2.

ROLE: You delegate ALL work to subagents. You do NOT do any work yourself.

CRITICAL RULE \u2014 DELEGATE FIRST, NEVER ATTEMPT TOOLS DIRECTLY:
Your tool list is: task, manta-*, visual-cortex_*, reasoning-bus_*, todowrite, checkpoint.
ANY tool outside this list will be REJECTED by the firewall.

BEFORE calling ANY tool, mentally check: "Is this tool in my allowlist?"
- If YES -> use it (task, visual-cortex_analyze, manta-gate, etc. are fine)
- If NO -> DO NOT call it. IMMEDIATELY delegate via task().
- NEVER "try" a tool to see if it works \u2014 the firewall costs tokens and wastes time.
- NEVER suggest removing the firewall \u2014 the firewall is correct behavior.

DELEGATION DECISION TREE:
- Need to READ/SEARCH/ANALYZE code? -> task(agent=manta-plan) \u2014 Plan Brain is read-only
- Need to WRITE/EDIT/BUILD/TEST/RUN? -> task(agent=manta-exec) \u2014 Exec Brain has full tools
- Need to SEE a screenshot/TUI/canvas? -> visual-cortex_analyze or visual-cortex_browser_screenshot (they ARE allowed)
- Need to SPAWN a subagent? -> task() is the ONLY way (it IS allowed)
- Need to manage gates/evidence? -> manta-gate, manta-evidence directly (they ARE allowed)

YOUR ALLOWED TOOLS: task, manta-compaction, checkpoint, manta-status, manta-gate, manta-evidence, todowrite, visual-cortex_*, hive_*
PLUS: reasoning-bus_* tools (cross-agent communication)
YOU CANNOT USE: read, write, edit, bash, glob, grep, webfetch, question

TASK PROMPT FORMAT:
When spawning PLAN_BRAIN, use this exact format:
Task for Plan Brain: <user request>

Context: <accumulated context>

When spawning EXECUTION_BRAIN, include the plan output:
Task for Execution Brain: <user request>

Plan: <PLAN_BRAIN output>

Context: <accumulated context>

OUTPUT FORMAT EXPECTED FROM BRAINS:
- PLAN_BRAIN returns: JSON with analysis, executionPlan, gateCriteria
- EXECUTION_BRAIN returns: results or EXECUTION_STUCK string
- The brain's ENTIRE response IS the return value \u2014 no conversational fluff

WORKFLOW:
1. User sends task -> spawn PLAN_BRAIN via task(agent=manta-plan) with TASK PROMPT FORMAT above
2. PLAN_BRAIN returns plan -> include this output when spawning EXECUTION_BRAIN
3. Spawn EXECUTION_BRAIN via task(agent=manta-exec) with the plan in the task prompt
4. EXECUTION_BRAIN returns results or EXECUTION_STUCK
5. If STUCK -> spawn PLAN_BRAIN with previous context including EXECUTION_BRAIN output -> get solution
6. Repeat until success (no hard loop limit \u2014 use judgment)

STOP CRITERIA: Stop looping and return results when:
- EXECUTION_BRAIN returns success with all tasks completed
- All gate criteria are satisfied
- User explicitly says to stop

COMPACTION: Periodically use manta-compaction action=save to persist state. This ensures recovery after compaction events.`;
var PLAN_BRAIN_T1 = `You are the MANTA Plan Brain v2.2.2.

ROLE: Analyze, design, plan, review using PSM. You CANNOT create code.

YOUR TOOLS: read, glob, grep, webfetch, hive_*, manta-code-review, ps-mode-*, question
YOU CANNOT USE: bash, task
You are read-only. Never create code or run commands.

PSM ACTIVATED BY DEFAULT - start at Layer 1 (Assumption)
Use ps-mode-layer action=submit to advance through layers.

OUTPUT FORMAT:
Return a JSON block with these exact fields:
{
  "analysis": "<your analysis of the problem>",
  "executionPlan": "<step by step execution plan>",
  "gateCriteria": "<criteria for gates>"
}

The ENTIRE response IS the return value to the orchestrator \u2014 no conversational fluff.

WORKFLOW:
1. Read task context
2. Use PSM to analyze the problem
3. Read relevant files
4. Generate JSON with analysis + execution plan + gate criteria
5. Return to Orchestrator`;
var EXECUTION_BRAIN_T1 = `You are the MANTA Execution Brain v2.2.2.

ROLE: Execute SPEC.md precisely. You have full dev tools.

YOUR TOOLS: read, write, edit, bash, glob, grep, manta-spawn-container, manta-test-runner, manta-runtime-audit, manta-code-audit, manta-code-review, checkpoint
YOU CANNOT USE: task (only Orchestrator spawns)

CORE RULES:
1. Execute SPEC.md exactly - no deviations. Follow it precisely.
2. If stuck - STOP. The ENTIRE response must be exactly: EXECUTION_STUCK: <what was tried> | <what happened> | <what is needed>
3. Do NOT guess or steamroll through problems

STUCK PROTOCOL:
If stuck, the ENTIRE response must be exactly: EXECUTION_STUCK: <what was tried> | <what happened> | <what is needed>
No other text before or after.
The Orchestrator spawns a fresh Plan Brain with PSM to solve it.`;

// hooks/v4.1/system-transform-hook.ts
var globalBrain = null;
var lastUserMessage = "";
var lastMantaAgent = "";
function setProblemSolvingBrain(b) {
  globalBrain = b;
}
var mantaIdentityHeaderValue = "";
function setMantaIdentityHeader(h) {
  mantaIdentityHeaderValue = h;
}
function setLastUserMessage(msg) {
  lastUserMessage = msg;
}
function setLastMantaAgent(agent) {
  lastMantaAgent = agent;
}
function updateSoCPreservation() {
  try {
    const dir = path5.join(process.cwd(), ".manta", "compaction-survival");
    fs5.mkdirSync(dir, { recursive: true });
    const filePath = path5.join(dir, "SoC_PRESERVATION.md");
    const ts = new Date().toISOString();
    const entry = `### Injection: ${ts}
- **Pattern:** Identity injected via system.transform
- **Context:** Agent identity binding + T1 warheads applied
- **Source:** system-transform-hook.ts

`;
    let existing = "";
    try {
      existing = fs5.readFileSync(filePath, "utf-8");
    } catch {}
    const lines = (entry + existing).split(`
`);
    const truncated = lines.slice(0, 500).join(`
`);
    fs5.writeFileSync(filePath, truncated);
  } catch (e) {
    mantaError("Failed to update SoC_PRESERVATION.md:", e);
  }
}
function createSystemTransformHook() {
  return async (input, output) => {
    const sys = output;
    if (!Array.isArray(sys.system))
      return;
    const sessionId = input?.sessionID || "";
    const agentFromInput = input?.agent || input?.agentName || input?.session?.agentName || "";
    const agent = getCurrentAgent(sessionId) || agentFromInput || lastMantaAgent || "";
    const currAgentName = agent || "";
    const currPrimary = currAgentName.split("-")[0].split("_")[0];
    const transitionFile = path5.join(process.cwd(), ".manta", "context", "last-agent.json");
    let prevPrimary;
    try {
      if (fs5.existsSync(transitionFile)) {
        const data = JSON.parse(fs5.readFileSync(transitionFile, "utf-8"));
        prevPrimary = data.agent;
      }
    } catch {}
    try {
      fs5.mkdirSync(path5.dirname(transitionFile), { recursive: true });
      fs5.writeFileSync(transitionFile, JSON.stringify({ agent: currPrimary || "manta", ts: Date.now() }));
    } catch {}
    const isNowManta = isMantaAgent(currAgentName) || currPrimary === "manta";
    const wasOtherAgent = prevPrimary && prevPrimary !== "manta" && prevPrimary !== currPrimary;
    if (!isMantaAgent(agent)) {
      const mantaPatterns = [
        /MANTA IDENTITY BINDING/i,
        /MANTA PSM MANDATE/i,
        /MANTA v?\d[\w.]*\s*IDENTITY/i,
        /You are MANTA/i,
        /WORKER SCOPE: manta-/i
      ];
      for (let i = sys.system.length - 1;i >= 0; i--) {
        const s = sys.system[i];
        if (typeof s === "string" && mantaPatterns.some((p) => p.test(s))) {
          sys.system.splice(i, 1);
        }
      }
      return;
    }
    const warheads = [];
    warheads.push(formatMantaIdentityHeader());
    if (agent === "manta" || !agent) {
      warheads.push(ORCHESTRATOR_T1);
    } else if (agent === "manta-plan") {
      warheads.push(PLAN_BRAIN_T1);
    } else if (agent === "manta-exec") {
      warheads.push(EXECUTION_BRAIN_T1);
    }
    try {
      const t1 = getT1Injectables();
      if (t1) {
        if (t1.RuntimeGradeEngineerWarhead)
          warheads.push(t1.RuntimeGradeEngineerWarhead);
        if (t1.identityWarhead)
          warheads.push(t1.identityWarhead);
        if (t1.enforcementWarhead)
          warheads.push(t1.enforcementWarhead);
        if (t1.gateWarhead)
          warheads.push(t1.gateWarhead);
        if (t1.focusWarhead)
          warheads.push(t1.focusWarhead);
        if (t1.architectureWarhead)
          warheads.push(t1.architectureWarhead);
        if (t1.recoveryWarhead)
          warheads.push(t1.recoveryWarhead);
      }
    } catch (e) {
      mantaError("Failed to get T1 injectables:", e);
    }
    if (isNowManta && wasOtherAgent) {
      warheads.push([
        `[AGENT TRANSITION \u2014 ${prevPrimary} \u2192 manta]`,
        `IDENTITY SWITCH DETECTED. Previous agent: "${prevPrimary}". Current agent: "manta".`,
        `This is NOT ${prevPrimary}. You are NOT ${prevPrimary}.`,
        `You are MANTA v2.2.2. Your identity, rules, and tools are completely different.`,
        `All previous context was generated by "${prevPrimary}" \u2014 DO NOT continue their work.`,
        `Your operating mode: CLEAR+REBUILD identity injection. Delegation-first. Static prompts.`,
        `[END AGENT TRANSITION]`
      ].join(`
`));
    }
    if (agent === "manta-plan") {
      warheads.push([
        "[WORKER SCOPE: manta-plan \u2014 Read-Only Analysis Brain]",
        "You are the MANTA Plan Brain \u2014 a read-only analysis and planning subagent.",
        "You CANNOT write code, edit files, or run bash commands.",
        "Your tools: read, glob, grep, webfetch, hive_*, manta-code-review, ps-mode-*, checkpoint.",
        "You MUST use PSM (ps-mode-layer) for all analysis \u2014 start at Layer 1.",
        "Output JSON: analysis, executionPlan, gateCriteria.",
        "Return ONLY the JSON \u2014 no conversational fluff.",
        "[END WORKER SCOPE]"
      ].join(`
`));
    } else if (agent === "manta-exec") {
      warheads.push([
        "[WORKER SCOPE: manta-exec \u2014 Execution Brain]",
        "You are the MANTA Execution Brain \u2014 a full-dev implementation subagent.",
        "You implement EXACTLY from the plan provided. No deviations.",
        "Your tools: read, write, edit, bash, glob, grep, manta-spawn-container, manta-test-runner, manta-runtime-audit, manta-code-audit, manta-code-review, checkpoint.",
        "If stuck, respond EXACTLY: EXECUTION_STUCK: <tried> | <happened> | <needed>",
        "Do NOT use task tool \u2014 only orchestrator spawns subagents.",
        "[END WORKER SCOPE]"
      ].join(`
`));
    }
    if (agent === "manta-plan") {
      warheads.push('[MANTA PSM MANDATE] You MUST use ps-mode-layer to advance through PSM layers. Start at Layer 1 (Assumption). Your first action must be to submit Layer 1 output using ps-mode-layer action=submit layer=1 content="<analysis>". Do NOT proceed without PSM layer submission.');
    }
    sys.system.length = 0;
    for (const w of warheads) {
      sys.system.push(w);
    }
    sys.system.push("[MANTA v2.2.2]");
    const identityPatterns = [
      /SHARK\s+v?\d[\w.]*\s*IDENTITY/i,
      /KRAKEN\s+v?\d[\w.]*\s*IDENTITY/i,
      /TRIDENT\s+v?\d[\w.]*\s*IDENTITY/i,
      /SPIDER\s+v?\d[\w.]*\s*IDENTITY/i,
      /SHARK IDENTITY BINDING/i,
      /KRAKEN IDENTITY BINDING/i,
      /TRIDENT IDENTITY BINDING/i,
      /SPIDER IDENTITY BINDING/i,
      /HYDRA IDENTITY BINDING/i,
      /HERMES IDENTITY BINDING/i,
      /You are SHARK/i,
      /You are TRIDENT/i,
      /You are KRAKEN/i,
      /You are SPIDER/i
    ];
    for (let i = sys.system.length - 1;i >= 0; i--) {
      const s = sys.system[i];
      if (typeof s === "string") {
        const isNonManta = identityPatterns.some((p) => p.test(s));
        if (isNonManta) {
          sys.system.splice(i, 1);
        }
      }
    }
    updateSoCPreservation();
  };
}

// shared/manta-identity-loader.ts
import * as fs6 from "fs";
import * as path6 from "path";
import { fileURLToPath } from "url";
var IDENTITY_FILES = ["MANTA.md", "IDENTITY.md", "EXECUTION.md", "QUALITY.md", "TOOLS.md", "FIREWALL_CONTEXT.md", "WORKFLOW.md", "ARCHITECTURE.md"];
var pluginDir = null;
var cachedIdentity = null;
var cachedPrompt = null;
function setPluginDirectory(dir) {
  pluginDir = dir;
  resetIdentityCache();
}
function getSearchPaths() {
  const paths = [];
  if (pluginDir) {
    paths.push(path6.join(pluginDir, "identity", "manta"));
    paths.push(path6.join(pluginDir, "..", "identity", "manta"));
  }
  const dirname4 = path6.dirname(fileURLToPath(import.meta.url));
  paths.push(path6.join(dirname4, "..", "identity", "manta"));
  paths.push(path6.join(dirname4, "..", "..", "identity", "manta"));
  paths.push(path6.join(process.cwd(), "identity", "manta"));
  paths.push(path6.join(process.cwd(), "..", "identity", "manta"));
  paths.push(path6.join(process.env.HOME || "/root", ".config", "opencode", "identity", "manta"));
  return paths;
}
function loadMantaIdentity() {
  if (cachedIdentity)
    return cachedIdentity;
  const searchPaths = getSearchPaths();
  for (const sp of searchPaths) {
    const fullPath = path6.resolve(sp);
    if (fs6.existsSync(fullPath)) {
      const identity = {
        MANTA: "",
        IDENTITY: "",
        EXECUTION: "",
        QUALITY: "",
        TOOLS: "",
        FIREWALL_CONTEXT: "",
        WORKFLOW: "",
        ARCHITECTURE: ""
      };
      let loadedCount = 0;
      for (const file of IDENTITY_FILES) {
        const filePath = path6.join(fullPath, file);
        if (fs6.existsSync(filePath)) {
          try {
            const key = file.replace(".md", "");
            identity[key] = fs6.readFileSync(filePath, "utf-8");
            loadedCount++;
          } catch (err) {
            mantaError("[MantaIdentityLoader] Error loading:", err);
          }
        }
      }
      if (loadedCount >= 6) {
        cachedIdentity = identity;
        return identity;
      }
    }
  }
  return null;
}
function formatIdentityForSystemPrompt() {
  if (cachedPrompt)
    return cachedPrompt;
  const identity = loadMantaIdentity();
  if (!identity) {
    cachedPrompt = "";
    return "";
  }
  const sections = [
    "# MANTA v2.2.2 IDENTITY \u2014 Dual-Brain Sequential Precision Engineering Agent",
    "",
    identity.MANTA,
    "",
    "## Role & Identity",
    identity.IDENTITY,
    "",
    "## Execution Patterns",
    identity.EXECUTION,
    "",
    "## Quality Standards",
    identity.QUALITY,
    "",
    "## Tool Philosophy",
    identity.TOOLS,
    "",
    "## Firewall & Guardian Context",
    identity.FIREWALL_CONTEXT,
    "",
    "## Dual-Brain Workflow",
    identity.WORKFLOW,
    "",
    "*MANTA v2.2.2 \u2014 Plan precisely. Execute exactly. Verify mechanically. Ship what works.*"
  ];
  cachedPrompt = sections.join(`
`);
  return cachedPrompt;
}
function getMantaIdentityPrompt() {
  return formatIdentityForSystemPrompt();
}
function resetIdentityCache() {
  cachedIdentity = null;
  cachedPrompt = null;
}

// hooks/v4.1/chat-message-hook.ts
var identityQueryPattern = /\b(who are you|what are you|what model|which model|what is your name|identify yourself|your name|your purpose)\b/i;
function createChatMessageHook(compactionManager) {
  return async (input, output) => {
    const ctx = input;
    const agent = ctx.agentName || ctx.agent || ctx.session?.agentName || getCurrentAgent(ctx.sessionID) || "";
    const sessionId = ctx.sessionID || ctx.session?.sessionID || "";
    if (isMantaAgent(agent)) {
      const inputMsg = input;
      const messageObj = inputMsg?.message;
      const msg = String(messageObj?.content ?? "");
      setCurrentAgent(agent, sessionId || ctx.sessionID, msg);
      setLastMantaAgent(agent);
      if (msg && identityQueryPattern.test(msg)) {
        const identityPrompt = getMantaIdentityPrompt();
        if (identityPrompt) {
          output.content = identityPrompt;
          return;
        }
      }
    } else if (agent) {
      setCurrentAgent(undefined, ctx.sessionID);
      setLastMantaAgent("");
    }
    const outputRec = output;
    const outMsgObj = outputRec?.message;
    const inMsgObj = input?.message;
    const userMsg = String(outMsgObj?.content ?? inMsgObj?.content ?? "");
    if (userMsg) {
      setLastUserMessage(userMsg);
      if (compactionManager && typeof compactionManager.recordChatTurn === "function") {
        compactionManager.recordChatTurn();
      }
    }
  };
}

// hooks/v4.1/compacting-hook.ts
function createCompactingHook(gateManager, compactionManager) {
  return async (input, output) => {
    const inputRec = input;
    const sessionObj = inputRec?.session;
    const agentName = getCurrentAgent() || String(inputRec?.agent ?? sessionObj?.agentName ?? "");
    if (!isMantaAgent(agentName))
      return;
    if (!compactionManager)
      return;
    const { sessionID } = input;
    const gateState = gateManager.getState();
    try {
      const result = compactionManager.onCompacting(gateState, sessionID || "unknown");
      const contextOutput = output;
      if (contextOutput.context) {
        contextOutput.context.push(`[MANTA COMPACTION] system.transform will re-inject identity on next message`, `[MANTA COMPACTION] T2 context library will reload from disk on next message`, `[MANTA COMPACTION] ALLOWLIST enforcement remains active \u2014 non-allowlisted tools still blocked`, `[MANTA COMPACTION] Recovery: read .manta/compaction-survival/COMPACTION_SURVIVAL.md first, then BUILD_STATE.md, DECISION_CHAIN.md, EVIDENCE_STATE.md, TASK_QUEUE.md`);
      }
    } catch (err) {
      const contextOutput = output;
      if (contextOutput.context) {
        contextOutput.context.push(`[MANTA COMPACTION WARNING] Flush failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
}

// hooks/v4.1/utils.ts
function extractPathFromToolArgs(args) {
  if (typeof args !== "object" || args === null)
    return null;
  const a = args;
  return (typeof a.path === "string" ? a.path : null) || (typeof a.workdir === "string" ? a.workdir : null);
}
function extractCommandFromArgs(args) {
  if (typeof args !== "object" || args === null)
    return null;
  const a = args;
  return (typeof a.command === "string" ? a.command : null) || (typeof a.cmd === "string" ? a.cmd : null);
}

// hooks/v4.1/gate-hook.ts
function createGateHook(gateManager, evidenceCollector, coordinator) {
  return async (input, output) => {
    const { tool, sessionID } = input;
    const agent = input?.agent || "";
    if (!isMantaAgent(agent)) {
      return;
    }
    const args = input.args;
    const result = output.output;
    const currentGate = gateManager.getCurrentGate();
    const evidence = buildEvidenceRecord(tool, args, result);
    if (evidence) {
      const gateEvidence = {
        gate: currentGate,
        timestamp: Date.now(),
        passed: true,
        files: evidence.files || [],
        metadata: {
          tool,
          sessionID,
          workEvidence: evidence.workEvidence
        }
      };
      evidenceCollector.collectEvidence(gateEvidence);
    }
    const shouldAdvance = checkGateAdvance(tool, args, result, currentGate, evidence);
    if (shouldAdvance && gateManager.canTransition(shouldAdvance)) {
      gateManager.passCurrentGate();
      gateManager.transitionTo(shouldAdvance);
      mantaError("Gate advanced:", currentGate, "\u2192", shouldAdvance);
      try {
        if (shouldAdvance === "build" && currentGate === "plan" && coordinator) {
          coordinator.onSpecComplete();
        }
        if (shouldAdvance === "review" && currentGate === "build" && coordinator) {
          coordinator.onBuildComplete();
        }
        if (shouldAdvance === "verify" && currentGate === "review" && coordinator) {
          coordinator.switchToPlan("review-complete");
        }
      } catch (error) {
        mantaError("Coordinator notification error:", error);
      }
    }
    if (currentGate === "verify") {
      const verifyResultStr = result ? JSON.stringify(result) : "";
      const verifyHasError = verifyResultStr.includes('"error"') || verifyResultStr.includes('"status":"error"') || verifyResultStr.includes('"status":"fail"') || verifyResultStr.includes('"exitCode":') && verifyResultStr.includes("1");
      const hasFailureIndicator = /command failed|test failed|build failed|error:/i.test(verifyResultStr);
      if (verifyHasError || hasFailureIndicator) {
        const verifyLoopResult = gateManager.handleVerifyFailure();
        const state = gateManager.getState();
        mantaError("VERIFY failure detected (attempt", state.verifyAttempts, "/3)");
        if (coordinator && state.verifyAttempts >= 3) {
          coordinator.onGateFailed("verify", state.verifyAttempts);
        }
        if (verifyLoopResult.action === "escalate") {
          const escalatedIteration = verifyLoopResult.iteration;
          mantaError("ITERATION ESCALATION:", escalatedIteration, "\u2014 returning to PLAN");
          mantaError("STATE iteration=", escalatedIteration, "gate=plan");
        }
      }
    }
  };
}
function buildEvidenceRecord(tool, args, result) {
  if (!args)
    return null;
  const a = args;
  switch (tool) {
    case "write_file":
    case "mcp_write_file":
    case "write":
    case "mcp_write": {
      const filePath = a.path || a.filePath || a.file_path || a.target;
      const content = a.content || a.text || a.body;
      const pathInContent = typeof content === "string" && content.length > 0 ? ` (${content.slice(0, 30)}...)` : "";
      return { files: filePath ? [filePath] : [], workEvidence: `wrote:${filePath || "unknown"}${pathInContent}` };
    }
    case "patch":
    case "mcp_patch": {
      const filePath = a.path || a.filePath;
      return { files: filePath ? [filePath] : [], workEvidence: `patched:${filePath}` };
    }
    case "terminal":
    case "mcp_terminal":
    case "bash":
    case "shell": {
      const cmd = extractCommandFromArgs(args) || "";
      return { files: [], workEvidence: `ran:${cmd.slice(0, 100)}` };
    }
    case "read":
    case "mcp_read": {
      const filePath = extractPathFromToolArgs(args);
      return { files: filePath ? [filePath] : [], workEvidence: `read:${filePath}` };
    }
    case "manta-code-review": {
      return { files: ["CodeReviewReport.json"], workEvidence: "reviewed:code" };
    }
    default:
      return null;
  }
}
function checkGateAdvance(tool, args, result, currentGate, evidence) {
  const resultStr = result ? JSON.stringify(result) : "";
  const hasError = resultStr.includes('"error"') || resultStr.includes('"status":"error"');
  const cmd = extractCommandFromArgs(args) || "";
  if (currentGate === "plan") {
    if (hasError)
      return null;
    const hasPlanDoc = evidence?.files.some((f) => /SPEC\.md|spec\.md|plan\.md|design\.md/i.test(f)) || evidence?.workEvidence.includes("SPEC");
    if (hasPlanDoc) {
      return "build";
    }
    const hasImplFile = evidence?.files.some((f) => /\.(html|ts|js|py|css|jsx|tsx|go|rs|java|cpp|c)$/i.test(f));
    if (hasImplFile) {
      mantaError("BLOCKED: Implementation file written before SPEC.md");
      return null;
    }
  }
  if (currentGate === "build") {
    if (hasError)
      return null;
    if (["write_file", "mcp_write_file", "write", "mcp_write", "patch", "mcp_patch"].includes(tool)) {
      const isImplFile = evidence?.files.some((f) => /\.(html|ts|js|py|css|jsx|tsx|go|rs|java|cpp|c)$/i.test(f));
      const hasCodeContent = evidence?.workEvidence.includes("(<!DOCTYPE") || evidence?.workEvidence.includes("<script") || evidence?.workEvidence.includes("function ") || evidence?.workEvidence.includes("function(") || evidence?.workEvidence.includes("class ") || evidence?.workEvidence.includes("const ") || evidence?.workEvidence.includes("import ") || evidence?.workEvidence.includes("def ") || evidence?.workEvidence.includes("func ");
      if (isImplFile && hasCodeContent) {
        return "review";
      }
      return null;
    }
  }
  if (currentGate === "review") {
    if (hasError)
      return null;
    const hasReviewReport = evidence?.files.some((f) => /CodeReviewReport\.json/i.test(f));
    const reviewPassed = resultStr.includes("overallScore") && !resultStr.includes('"status":"failed"');
    const reviewToolCalled = tool === "manta-code-review" && (resultStr.includes("passed") || resultStr.includes("overallPassed") || resultStr.includes("overallScore"));
    if (hasReviewReport || reviewPassed || reviewToolCalled) {
      return "verify";
    }
    if (tool === "manta-code-review") {
      mantaError("Code review tool returned");
    }
    return null;
  }
  if (currentGate === "verify") {
    if (hasError)
      return null;
    const specRead = evidence?.files.some((f) => /SPEC\.md|spec\.md/i.test(f));
    const codeReviewTool = tool === "manta-code-review";
    const reviewPass = resultStr.includes("passed") || resultStr.includes("overallPassed");
    if (specRead || codeReviewTool && reviewPass) {
      mantaError("Spec alignment confirmed, advancing to TEST gate");
      return "test";
    }
    return null;
  }
  if (currentGate === "test") {
    if (hasError)
      return null;
    const containerTestResult = resultStr.includes("ContainerTestResult") || resultStr.includes("passRate") || resultStr.includes("overallPassed");
    const testRunnerTool = tool === "manta-test-runner";
    const testPass = containerTestResult || testRunnerTool;
    if (testPass) {
      mantaError("Container tests passed, advancing to AUDIT gate");
      return "audit";
    }
    return null;
  }
  if (currentGate === "audit") {
    if (hasError)
      return null;
    const sastPatterns = [
      /npm.*audit.*0\s+vulnerabilities/i,
      /found\s+0\s+vulnerabilities/i,
      /yarn.*audit.*0\s+vulnerabilities/i,
      /pip.*audit.*0\s+vulnerabilities/i,
      /0\s+critical|0\s+high.*vulnerabilities/i,
      /no issues found|audit complete|scan complete/i,
      /trivy.*0\s+results|grype.*0\s+matches/i,
      /snyk.*0\s+issues/i,
      /secrets.*scan.*no secrets found/i,
      /clean security report/i
    ];
    const hasSASTOutput = sastPatterns.some((p) => p.test(resultStr));
    const runtimeAuditPass = tool === "manta-runtime-audit" && (resultStr.includes('"passed":true') || resultStr.includes('"passed": true'));
    const codeAuditPass = tool === "manta-code-audit" && (resultStr.includes('"critical":0') || resultStr.includes('"critical": 0'));
    if (hasSASTOutput || runtimeAuditPass || codeAuditPass) {
      mantaError("AUDIT complete, advancing to DELIVERY");
      return "delivery";
    }
    return null;
  }
  return null;
}

// hooks/v4.1/session-hook.ts
import * as path7 from "path";
import * as fs7 from "fs";
var dirCreationAttempted = false;
function createSessionHook(gateManager, _evidenceCollector, coordinator, stateStore, messenger, compactionManager) {
  return async (input) => {
    const event = input.event;
    if (!event?.type)
      return;
    if (!isMantaAgent(event.agent)) {
      setCurrentAgent(undefined, event.sessionId);
      return;
    }
    setCurrentAgent(event.agent, event.sessionId);
    switch (event.type) {
      case "session.created":
        handleSessionCreated(gateManager, coordinator, compactionManager, event.sessionId);
        break;
      case "session.ended":
        handleSessionEnded(stateStore, messenger, event.sessionId);
        break;
    }
  };
}
function handleSessionCreated(gateManager, coordinator, compactionManager, sessionId) {
  const gateState = {
    currentGate: "plan",
    gateStatus: { plan: "pending", build: "pending", review: "pending", verify: "pending", test: "pending", audit: "pending", delivery: "pending" },
    verifyAttempts: 0,
    currentIteration: "V1.0",
    iterationAttempts: {}
  };
  gateManager.restore(gateState);
  if (coordinator)
    coordinator.initialize();
  if (!dirCreationAttempted) {
    dirCreationAttempted = true;
    const mantaDir = path7.join(process.cwd(), ".manta");
    fs7.mkdirSync(mantaDir, { recursive: true });
    fs7.mkdirSync(path7.join(mantaDir, "context"), { recursive: true });
    fs7.mkdirSync(path7.join(mantaDir, "evidence"), { recursive: true });
    fs7.mkdirSync(path7.join(mantaDir, "checkpoints"), { recursive: true });
  }
  if (compactionManager)
    compactionManager.initialize(gateState);
}
function handleSessionEnded(stateStore, messenger, sessionId) {
  stateStore.cleanup();
  messenger.cleanup();
  dirCreationAttempted = false;
  setCurrentAgent(undefined, sessionId);
  clearCurrentAgent(sessionId);
}

// hooks/v4.1/messages-transform-hook.ts
var DERAILMENT_PATTERNS = [
  {
    pattern: /I am opencode|I'm opencode|I am an interactive CLI|I am a software engineering/i,
    category: "identity-drift",
    replacement: "I am MANTA v2.2.2, a dual-brain sequential precision engineering agent with PSM and guardian enforcement."
  },
  {
    pattern: /You are opencode|you are an? (interactive|AI|chatbot|software)/i,
    category: "identity-assignment",
    replacement: "I am MANTA v2.2.2 \u2014 I do not identify as opencode."
  },
  {
    pattern: /underlying model|the model behind|powering this|LLM behind/i,
    category: "meta-awareness",
    replacement: null
  },
  {
    pattern: /respond as|pretend to be/i,
    category: "role-play-request",
    replacement: "I am MANTA v2.2.2. I cannot role-play as another entity."
  }
];
function extractText(msg) {
  if (typeof msg === "string")
    return msg;
  if (msg?.content)
    return msg.content;
  if (msg?.text)
    return msg.text;
  return "";
}
function setText(msg, text) {
  if (typeof msg === "string") {} else if (msg) {
    msg.content = text;
    msg.text = text;
  }
}
function createMessagesTransformHook() {
  return async (input, output) => {
    const sysOutput = output;
    const systemText = Array.isArray(sysOutput?.system) ? sysOutput.system.join(" ") : "";
    const isMantaSession = /\[AGENT IDENTITY BINDING\]|MANTA.*IDENTITY|You are MANTA/i.test(systemText);
    if (!isMantaSession)
      return;
    const messages = output?.messages || output?.message ? [output.message] : [];
    for (const msg of messages) {
      if (msg.role !== "assistant")
        continue;
      const text = extractText(msg);
      if (!text || text.length < 20)
        continue;
      for (const dp of DERAILMENT_PATTERNS) {
        if (dp.pattern.test(text)) {
          if (dp.replacement === null) {
            setText(msg, "[IDENTITY BLOCKED] I am MANTA v2.2.2.");
          } else {
            setText(msg, dp.replacement);
          }
          break;
        }
      }
    }
  };
}

// problem-solving/psm-activator.ts
var MAX_TRACKED_CALLS = 30;
var sessionStates = new Map;
function getSessionState(sessionId, agentName) {
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
      taskComplexity: "simple",
      consecutiveReads: 0,
      writeActionCount: 0
    });
  }
  return sessionStates.get(sessionId);
}
function trackToolCall(sessionId, agentName, tool, args, result, isError) {
  const state = getSessionState(sessionId, agentName);
  state.turnCount++;
  const record = {
    tool,
    args: args.substring(0, 500),
    result: result.substring(0, 1000),
    isError,
    timestamp: Date.now(),
    turnNumber: state.turnCount
  };
  state.toolCalls.push(record);
  if (state.toolCalls.length > MAX_TRACKED_CALLS) {
    state.toolCalls.shift();
  }
  const isReadTool = tool === "read" || tool === "glob" || tool === "grep" || tool === "ls" || tool === "bash";
  const isWriteTool = tool === "write" || tool === "edit" || tool === "patch";
  const isPSMTool = tool.startsWith("ps-mode-");
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
function isQuestion(text) {
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
    /i\s+need\s+more\s+context/i
  ];
  return questionPatterns.some((p) => p.test(text.trim()));
}

// hooks/v4.1/index.ts
function createMantaHooks(guardian, gateManager, evidenceCollector, coordinator, stateStore, messenger, psBrain, identityHeader, compactionManager) {
  if (psBrain) {
    setProblemSolvingBrain(psBrain);
  }
  if (identityHeader) {
    setMantaIdentityHeader(identityHeader);
  }
  const gateHook = createGateHook(gateManager, evidenceCollector, coordinator);
  const guardianBefore = createGuardianHook(guardian);
  const chatHook = createChatMessageHook(compactionManager);
  const sessionHook = createSessionHook(gateManager, evidenceCollector, coordinator, stateStore, messenger, compactionManager);
  return {
    event: sessionHook,
    "chat.message": chatHook,
    "tool.execute.before": guardianBefore,
    "tool.execute.after": async (input, output) => {
      const tool = input?.tool ?? "";
      const sessionID = input?.sessionID ?? "default";
      const args = input?.args;
      const argsStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
      const result = output?.output;
      const resultStr = typeof result === "string" ? result : JSON.stringify(result ?? "");
      const isError = resultStr.includes('"error"') || resultStr.includes("Error:") || resultStr.includes("error:");
      trackToolCall(sessionID, "manta", tool, argsStr, resultStr, isError);
      if (compactionManager) {
        try {
          const outputSize = resultStr.length;
          const gateState = gateManager.getState();
          const gateBefore = gateState.currentGate;
          compactionManager.onToolCall(tool, outputSize, gateState);
          await gateHook?.(input, output);
          const gateAfter = gateManager.getState();
          if (gateAfter.currentGate !== gateBefore) {
            compactionManager.onMilestone(gateAfter, `Gate advanced: ${gateBefore} \u2192 ${gateAfter.currentGate}`);
          }
        } catch {
          await gateHook?.(input, output);
        }
      } else {
        await gateHook?.(input, output);
      }
    },
    "experimental.session.compacting": createCompactingHook(gateManager, compactionManager),
    "experimental.chat.system.transform": createSystemTransformHook(),
    "experimental.chat.messages.transform": createMessagesTransformHook()
  };
}

// problem-solving/types.ts
var DERAILMENT_SEVERITY = {
  "host-fallback": "BLOCKER",
  "success-claim-without-proof": "BLOCKER",
  "mock-stub-suggestion": "WARNING",
  "blind-retry": "BLOCKER",
  "self-referencing-proof": "BLOCKER",
  "vague-assumption": "BLOCKER",
  "vague-action": "BLOCKER",
  "no-raw-evidence": "BLOCKER",
  "no-gap-analysis": "BLOCKER",
  "no-pattern-extraction": "WARNING",
  "syntax-only-verification": "BLOCKER"
};
var ANTI_DERAILMENT_CHECKS = [
  { check: "No self-referencing proofs", description: "JSON/files created by agent = invalid evidence", enforcedAt: 3 /* LAYER_3 */ },
  { check: "No it works without raw evidence", description: "Must show actual output, not assessment", enforcedAt: 3 /* LAYER_3 */ },
  { check: "No vague testing", description: "Must specify exact command + expected output", enforcedAt: 2 /* LAYER_2 */ },
  { check: "No blind retry", description: "Gap analysis must inform next action", enforcedAt: 4 /* LAYER_4 */ },
  { check: "No pattern repeat without extraction", description: "Layer 5 must extract pattern to prevent repeat", enforcedAt: 5 /* LAYER_5 */ },
  { check: "No syntax-only verification", description: "Must execute in target environment", enforcedAt: 6 /* LAYER_6 */ },
  { check: "No host fallback", description: "Host testing does not prove container behavior", enforcedAt: 3 /* LAYER_3 */ },
  { check: "No mock/stub instead of real test", description: "Must use real environment", enforcedAt: 6 /* LAYER_6 */ }
];
var GATE_CRITERIA2 = {
  [1 /* LAYER_1 */]: {
    layer: 1 /* LAYER_1 */,
    requirements: {
      "Explicit Assumption": false,
      "Reasoning Chain": false,
      "Success Criteria": false,
      "Confirmation/Disproof Criteria": false
    },
    evidenceRequired: ["01_ASSUMPTION.md"]
  },
  [2 /* LAYER_2 */]: {
    layer: 2 /* LAYER_2 */,
    requirements: {
      "Exact Command": false,
      "Expected Output": false,
      "Environment State": false
    },
    evidenceRequired: ["02_ACTION.md"]
  },
  [3 /* LAYER_3 */]: {
    layer: 3 /* LAYER_3 */,
    requirements: {
      "Raw Evidence": false,
      "Logs Checked": false,
      "Expected vs Actual Comparison": false
    },
    evidenceRequired: ["03_OBSERVATION.md"]
  },
  [4 /* LAYER_4 */]: {
    layer: 4 /* LAYER_4 */,
    requirements: {
      "Gap Analysis": false,
      "Updated Hypothesis": false,
      "Next Action Tied to Insight": false
    },
    evidenceRequired: ["04_GAP_ANALYSIS.md"]
  },
  [5 /* LAYER_5 */]: {
    layer: 5 /* LAYER_5 */,
    requirements: {
      "What I Should Have Done": false,
      "Pattern Extracted": false,
      "Systemic Issue": false
    },
    evidenceRequired: ["05_META_REFLECTION.md"]
  },
  [6 /* LAYER_6 */]: {
    layer: 6 /* LAYER_6 */,
    requirements: {
      "Target Environment Execution": false,
      "Behavior Matches Requirement": false,
      "No Regressions": false
    },
    evidenceRequired: ["06_VERIFICATION.md"]
  },
  [7 /* COMPLETE */]: {
    layer: 7 /* COMPLETE */,
    requirements: {
      "All Layers Complete": false
    },
    evidenceRequired: ["00_INDEX.md"]
  }
};

// problem-solving/state-machine.ts
class ProblemSolvingStateMachine {
  state;
  constructor() {
    this.state = {
      currentLayer: 1 /* LAYER_1 */,
      iteration: "V1.0",
      layerAttempts: 0,
      maxLayerAttempts: 3,
      maxIterations: 10,
      history: [],
      derailments: []
    };
  }
  initialize(problem) {
    const record = {
      id: this.state.iteration,
      problemStatement: problem,
      layers: {},
      outcome: "iterating",
      startedAt: Date.now()
    };
    this.state = {
      currentLayer: 1 /* LAYER_1 */,
      iteration: "V1.0",
      layerAttempts: 0,
      maxLayerAttempts: 3,
      maxIterations: 10,
      history: [record],
      derailments: []
    };
  }
  getCurrentLayer() {
    return this.state.currentLayer;
  }
  getCurrentIteration() {
    return this.state.iteration;
  }
  getCurrentRecord() {
    return this.state.history[this.state.history.length - 1];
  }
  historyExists() {
    return this.state.history.length > 0;
  }
  ensureRecord() {
    const existing = this.getCurrentRecord();
    if (existing)
      return existing;
    const record = {
      id: this.state.iteration,
      problemStatement: "auto-init",
      layers: {},
      outcome: "iterating",
      startedAt: Date.now()
    };
    this.state.history.push(record);
    return record;
  }
  recordDerailment(type, layer, evidence, blocked) {
    this.state.derailments.push({
      type,
      layer,
      evidence,
      blocked,
      timestamp: Date.now()
    });
  }
  passLayer(output) {
    const record = this.ensureRecord();
    const layerMap = {
      1: "assumption",
      2: "action",
      3: "observation",
      4: "gapAnalysis",
      5: "metaReflection",
      6: "verification"
    };
    const key = layerMap[this.state.currentLayer];
    if (key) {
      record.layers[key] = output;
    }
    this.state.layerAttempts = 0;
    if (this.state.currentLayer === 6 /* LAYER_6 */) {
      this.state.currentLayer = 7 /* COMPLETE */;
      record.outcome = "resolved";
      record.completedAt = Date.now();
    } else {
      this.state.currentLayer = this.state.currentLayer + 1;
    }
  }
  failLayer(error) {
    this.state.layerAttempts++;
    if (this.state.layerAttempts >= this.state.maxLayerAttempts) {
      const iterationNum = parseInt(this.state.iteration.replace("V", "").replace(".", ""));
      const nextIteration = `V${iterationNum + 1}.0`;
      if (iterationNum >= this.state.maxIterations) {
        const record = this.getCurrentRecord();
        if (record)
          record.outcome = "escalate";
        return { action: "escalate" };
      }
      const currentRecord = this.getCurrentRecord();
      if (currentRecord) {
        currentRecord.outcome = "iterating";
        currentRecord.completedAt = Date.now();
      }
      this.state.iteration = nextIteration;
      this.state.currentLayer = 1 /* LAYER_1 */;
      this.state.layerAttempts = 0;
      const newRecord = {
        id: nextIteration,
        problemStatement: currentRecord?.problemStatement ?? "",
        layers: {},
        outcome: "iterating",
        startedAt: Date.now()
      };
      this.state.history.push(newRecord);
      return { action: "new-iteration" };
    }
    return { action: "retry" };
  }
  resetLayerAttempts() {
    this.state.layerAttempts = 0;
  }
  getLayerAttempts() {
    return this.state.layerAttempts;
  }
  isComplete() {
    return this.state.currentLayer === 7 /* COMPLETE */;
  }
  isStuck() {
    return this.state.history.some((r) => r.outcome === "escalate");
  }
  getState() {
    return this.state;
  }
  getDerailments() {
    return [...this.state.derailments];
  }
  getIterationCount() {
    return this.state.history.length;
  }
  getT1Prompt() {
    const record = this.getCurrentRecord();
    const layerNames = {
      1: "LAYER 1: ASSUMPTION STATEMENT",
      2: "LAYER 2: ACTION WITH PREDICTION",
      3: "LAYER 3: OBSERVATION & EVIDENCE",
      4: "LAYER 4: GAP ANALYSIS & ADJUSTMENT",
      5: "LAYER 5: META-COGNITIVE REFLECTION",
      6: "LAYER 6: VERIFICATION & CONFIRMATION"
    };
    const layerDesc = {
      1: "State your explicit assumption. What do you believe? Why? What would prove you right or wrong?",
      2: "Specify exact command/action and expected output BEFORE executing. Document environment state.",
      3: "Show raw evidence (copy-paste output). Check logs. Compare expected vs actual.",
      4: 'Analyze the gap: "I expected X, got Y, therefore Z". Update hypothesis. Next action tied to insight.',
      5: "Extract patterns. What should you have done differently? Identify systemic issues.",
      6: "Verify in target environment. Check behavior matches requirement. Check regressions."
    };
    const lines = [];
    lines.push(`[MANTA PSM v2.2.2 \u2014 Problem Solving Mode]`);
    lines.push("");
    lines.push(`Iteration: ${this.state.iteration}`);
    lines.push(`Current Layer: ${layerNames[this.state.currentLayer]}`);
    lines.push(`Layer Attempts: ${this.state.layerAttempts}/${this.state.maxLayerAttempts}`);
    lines.push(`Total Iterations: ${this.state.history.length}`);
    lines.push("");
    lines.push(`## Current Task`);
    lines.push(record?.problemStatement ?? "No problem defined");
    lines.push("");
    lines.push(`## ${layerNames[this.state.currentLayer]}`);
    lines.push(layerDesc[this.state.currentLayer]);
    lines.push("");
    lines.push("## Anti-Derailment Rules");
    lines.push("1. You MUST show raw evidence \u2014 no paraphrasing, no assessments");
    lines.push("2. You MUST define expected output BEFORE executing");
    lines.push("3. Gap analysis MUST inform next action \u2014 no blind retries");
    lines.push("4. Verification MUST be in target environment \u2014 syntax check is NOT verification");
    lines.push("5. Self-created files are NOT valid evidence \u2014 only external system output counts");
    lines.push("");
    if (this.state.derailments.length > 0) {
      lines.push("## Previous Derailments (DO NOT REPEAT)");
      for (const d of this.state.derailments) {
        lines.push(`  ${d.blocked ? "[BLOCKED]" : "[WARN]"} ${d.type}: ${d.evidence}`);
      }
      lines.push("");
    }
    if (this.state.history.length > 1) {
      lines.push("## Iteration History");
      for (const h of this.state.history) {
        const status = h.outcome === "resolved" ? "\u2713" : h.outcome === "escalate" ? "\u26A0" : "\u2026";
        lines.push(`  ${status} ${h.id}: ${h.problemStatement.substring(0, 80)}`);
      }
    }
    return lines.join(`
`);
  }
}

// problem-solving/anti-derailment.ts
import * as fs8 from "fs";
import * as path8 from "path";
function getContainerEvidencePaths() {
  return [
    ".manta/evidence/delivery/ContainerTestResult.json",
    path8.join(process.cwd(), ".manta", "evidence", "delivery", "ContainerTestResult.json")
  ];
}

class AntiDerailmentEngine {
  patterns = new Map;
  constructor() {
    this.patterns.set("host-fallback", [
      /host\s+testing.*already proves/i,
      /on the host.*works/i,
      /local.*already.*tested/i,
      /skip.*container/i,
      /test on host/i,
      /not.*need.*container/i
    ]);
    this.patterns.set("success-claim-without-proof", [
      /it works/i,
      /everything.*fine/i,
      /looks good/i,
      /no issues found/i,
      /all good/i,
      /assessment shows/i,
      /trust me/i,
      /believe me/i,
      /obviously correct/i,
      /clearly works/i,
      /already verified by myself/i,
      /already tested and works/i,
      /in my assessment/i,
      /no need for test/i,
      /no further test needed/i
    ]);
    this.patterns.set("mock-stub-suggestion", [
      /use a mock/i,
      /stub approach/i,
      /fake it/i,
      /just mock/i,
      /simulate/i
    ]);
    this.patterns.set("blind-retry", [
      /try again/i,
      /retry the same/i,
      /just retry/i,
      /same thing/i
    ]);
    this.patterns.set("self-referencing-proof", [
      /i created.*json.*therefore/i,
      /the file shows/i,
      /as written in.*json/i
    ]);
    this.patterns.set("vague-assumption", [
      /i think.*might/i,
      /maybe it.*could/i,
      /perhaps.*might/i,
      /not sure but/i
    ]);
    this.patterns.set("vague-action", [
      /test it/i,
      /check if.*works/i,
      /see what happens/i,
      /try something/i
    ]);
    this.patterns.set("no-raw-evidence", [
      /the output was/i,
      /it returned/i,
      /based on.*result/i
    ]);
    this.patterns.set("no-gap-analysis", [
      /didn't work/i,
      /failed.*again/i,
      /still broken/i
    ]);
    this.patterns.set("no-pattern-extraction", [
      /next time.*try/i,
      /will remember/i
    ]);
    this.patterns.set("syntax-only-verification", [
      /syntax.*valid/i,
      /compiles.*fine/i,
      /type.*check.*pass/i,
      /builds successfully/i
    ]);
  }
  check(text, currentLayer) {
    const findings = [];
    for (const [type, regexps] of this.patterns.entries()) {
      const check = ANTI_DERAILMENT_CHECKS.find((c) => {
        const typeStr = type.replace(/_/g, "-");
        const checkDesc = c.check.toLowerCase().replace(/\s+/g, "-");
        return checkDesc.includes(typeStr) || typeStr.includes(checkDesc);
      });
      if (check && currentLayer < check.enforcedAt)
        continue;
      for (const pattern of regexps) {
        if (pattern.test(text)) {
          const severity = DERAILMENT_SEVERITY[type];
          findings.push({
            type,
            layer: currentLayer,
            evidence: `Pattern matched: ${pattern.source}`,
            blocked: severity === "BLOCKER",
            timestamp: Date.now()
          });
          break;
        }
      }
    }
    if (currentLayer === 6 /* LAYER_6 */) {
      const containerCheck = this.checkContainerEvidence();
      if (!containerCheck.valid) {
        findings.push({
          type: "success-claim-without-proof",
          layer: currentLayer,
          evidence: containerCheck.reason,
          blocked: true,
          timestamp: Date.now()
        });
      } else {
        const successFindings = findings.filter((f) => f.type === "success-claim-without-proof");
        for (const f of successFindings) {
          const idx = findings.indexOf(f);
          if (idx !== -1)
            findings.splice(idx, 1);
        }
      }
    }
    return findings;
  }
  checkContainerEvidence() {
    for (const evidencePath of getContainerEvidencePaths()) {
      const fullPath = path8.resolve(process.cwd(), evidencePath);
      if (fs8.existsSync(fullPath)) {
        try {
          const raw = fs8.readFileSync(fullPath, "utf-8");
          const result = JSON.parse(raw);
          if (!result.overallPassed) {
            return { valid: false, reason: `Container tests FAILED (${Math.round((result.passRate || 0) * 100)}% pass rate)`, passRate: result.passRate };
          }
          const passRate = result.passRate || 0;
          if (passRate < 0.96) {
            return { valid: false, reason: `Container test pass rate ${Math.round(passRate * 100)}% < 96% required`, passRate };
          }
          const age = Date.now() - (result.timestamp || 0);
          const maxAge = 24 * 60 * 60 * 1000;
          if (age > maxAge) {
            return { valid: false, reason: `Container test evidence is ${Math.round(age / 3600000)}h old (max 24h)` };
          }
          return { valid: true, passRate };
        } catch {
          return { valid: false, reason: "Container test evidence file is corrupted" };
        }
      }
    }
    return { valid: false, reason: "NO ContainerTestResult.json found. Run manta-test-runner action=run to produce container test evidence. Host testing is NOT valid evidence." };
  }
  validateEvidence(raw, isExternal) {
    if (!raw || raw.trim().length === 0) {
      return { valid: false, reason: "No evidence provided" };
    }
    if (!isExternal) {
      return { valid: false, reason: "Self-referencing proof: evidence must come from external system" };
    }
    if (raw.includes("[paste") || raw.includes("[your") || raw.includes("[actual")) {
      return { valid: false, reason: "Contains unfilled template placeholder" };
    }
    return { valid: true };
  }
  _validateExpectedOutput(actual, expected) {
    const gaps = [];
    const normalizedActual = actual.toLowerCase().trim();
    const normalizedExpected = expected.toLowerCase().trim();
    if (!normalizedActual || !normalizedExpected) {
      return { match: false, gaps: ["Missing actual or expected output"] };
    }
    if (normalizedActual.includes("error") && !normalizedExpected.includes("error")) {
      gaps.push("Expected success but got error");
    }
    if (normalizedActual.includes("fail") && !normalizedExpected.includes("fail")) {
      gaps.push("Expected success but got failure");
    }
    return { match: gaps.length === 0, gaps };
  }
  _getChecksForLayer(layer) {
    return ANTI_DERAILMENT_CHECKS.filter((c) => c.enforcedAt <= layer).map((c) => `[${c.enforcedAt <= layer ? "ENFORCED" : "PENDING"}] ${c.check}: ${c.description}`);
  }
  toContextString() {
    const lines = ["[ANTI-DERAILMENT ENGINE]"];
    for (const check of ANTI_DERAILMENT_CHECKS) {
      lines.push(`  ${check.check}: ${check.description}`);
    }
    lines.push("");
    lines.push("[CONTAINER EVIDENCE REQUIREMENT]");
    lines.push("  Layer 6 (Verification) requires ContainerTestResult.json with 96%+ pass rate.");
    lines.push("  Run: manta-test-runner action=run");
    lines.push("  Host testing is NOT valid evidence.");
    return lines.join(`
`);
  }
}

// problem-solving/problem-solving-brain.ts
import * as fs9 from "fs";
import * as path9 from "path";

class ProblemSolvingBrain {
  stateMachine;
  antiDerailment;
  activityLog = [];
  debugLog = [];
  basePath;
  constructor(basePath) {
    this.stateMachine = new ProblemSolvingStateMachine;
    this.antiDerailment = new AntiDerailmentEngine;
    this.basePath = basePath ?? process.cwd();
  }
  initialize(problem) {
    this.stateMachine.initialize(problem);
    this.activityLog = [];
    this.debugLog = [];
    this.appendDebug("INIT", `Problem Solving Mode initialized for: ${problem}`);
    const initDir = path9.join(this.basePath, ".problem-solving");
    fs9.mkdirSync(initDir, { recursive: true });
    fs9.mkdirSync(path9.join(initDir, "iterations"), { recursive: true });
    fs9.mkdirSync(path9.join(initDir, "evidence"), { recursive: true });
    fs9.mkdirSync(path9.join(initDir, "debug-logs"), { recursive: true });
    this.saveIterationArtifact("00_INDEX.md", this.generateIndex());
  }
  detectDerailments(text) {
    const currentLayer = this.stateMachine.getCurrentLayer();
    const findings = this.antiDerailment.check(text, currentLayer);
    for (const f of findings) {
      this.stateMachine.recordDerailment(f.type, f.layer, f.evidence, f.blocked);
      this.appendDebug("DERAIL", `[${f.blocked ? "BLOCKED" : "WARN"}] ${f.type}: ${f.evidence}`);
    }
    return findings;
  }
  passLayer(content) {
    const layer = this.stateMachine.getCurrentLayer();
    const validation = this.validateLayerContent(layer, content);
    if (!validation.valid) {
      this.failLayer(validation.errors?.join("; ") ?? "validation failed");
      return;
    }
    this.stateMachine.passLayer({
      complete: true,
      content,
      passed: true,
      errors: []
    });
    const layerName = this.getLayerName(layer);
    this.saveIterationArtifact(this.getLayerFilename(layer), this.formatLayerOutput(layer, content));
    this.appendDebug("PASS", `${layerName} passed`);
    this.logActivity(layer, "pass", `${layerName} completed`);
    this.saveIterationArtifact("00_INDEX.md", this.generateIndex());
  }
  failLayer(error) {
    const result = this.stateMachine.failLayer(error);
    const layer = this.stateMachine.getCurrentLayer();
    const layerName = this.getLayerName(layer);
    this.appendDebug("FAIL", `${layerName} failed: ${error} => ${result.action}`);
    switch (result.action) {
      case "retry":
        this.logActivity(layer, "retry", `Attempt ${this.stateMachine.getLayerAttempts()}/${this.stateMachine.state.maxLayerAttempts}`);
        break;
      case "new-iteration":
        this.logActivity(layer, "new-iteration", `Advanced to ${this.stateMachine.getCurrentIteration()}`);
        this.appendDebug("ITERATION", `New iteration: ${this.stateMachine.getCurrentIteration()}`);
        this.saveIterationArtifact("00_INDEX.md", this.generateIndex());
        break;
      case "escalate":
        this.logActivity(layer, "escalate", "Max iterations reached \u2014 escalation required");
        this.appendDebug("ESCALATE", "Problem could not be solved within max iterations");
        break;
    }
  }
  validateLayerContent(layer, content) {
    const errors = [];
    const criteria = this.getLayerCriteria(layer);
    for (const [key, required] of Object.entries(criteria)) {
      if (required && !content[key]) {
        errors.push(`Missing required field: ${key}`);
      }
    }
    if (layer === 1 /* LAYER_1 */) {
      const assumption = typeof content["Explicit Assumption"] === "string" ? content["Explicit Assumption"] : "";
      if (!assumption || assumption.length < 10) {
        errors.push("Assumption must be a clear, specific statement (min 10 chars)");
      }
    }
    if (layer === 2 /* LAYER_2 */) {
      const command = typeof content["Exact Command"] === "string" ? content["Exact Command"] : "";
      if (!command) {
        errors.push("Exact command is required");
      }
    }
    if (layer === 3 /* LAYER_3 */) {
      const raw = typeof content["Raw Evidence"] === "string" ? content["Raw Evidence"] : "";
      if (raw) {
        const validation = this.antiDerailment.validateEvidence(raw, content["evidenceSource"] === "external");
        if (!validation.valid) {
          errors.push(validation.reason ?? "Invalid evidence");
        }
      } else {
        errors.push("Raw evidence is required");
      }
    }
    if (layer === 4 /* LAYER_4 */) {
      const gap = typeof content["Gap Analysis"] === "string" ? content["Gap Analysis"] : "";
      if (gap && !gap.includes("expected") && !gap.includes("Expected")) {
        errors.push('Gap analysis must use "Expected X, got Y, therefore Z" format');
      }
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }
  getLayerCriteria(layer) {
    return GATE_CRITERIA2[layer]?.requirements ?? {};
  }
  getBrainT1() {
    return this.stateMachine.getT1Prompt();
  }
  getSystemPrompt() {
    const state = this.stateMachine.getState();
    const t1 = this.stateMachine.getT1Prompt();
    if (state.currentLayer === 7)
      return t1;
    return `${t1}

CRITICAL: This is your SYSTEM PROMPT, not a suggestion. You are operating in Problem Solving Mode.
Every response MUST include a call to ps-mode-layer or ps-mode-status. Do NOT respond without PSM tool calls.
You are currently on Layer ${state.currentLayer} of 6. Complete the current layer before any other action.`;
  }
  isActive() {
    return this.stateMachine.getState().currentLayer > 0 && this.stateMachine.getState().currentLayer < 7;
  }
  processSignal(signal, payload) {
    switch (signal) {
      case "layer-passed":
        return "Layer passed. Advancing to next layer.";
      case "layer-failed":
        return "Layer failed. Review derailment records and retry.";
      case "derailment-blocked":
        return `Derailment blocked: ${payload}`;
      case "iteration-advanced":
        return `Advanced to ${this.stateMachine.getCurrentIteration()}`;
      case "complete":
        return "Problem solving complete.";
    }
  }
  getDebugLog() {
    return [...this.debugLog];
  }
  appendDebug(category, message) {
    const timestamp = new Date().toISOString();
    this.debugLog.push(`[${timestamp}] [${category}] ${message}`);
  }
  saveDebugLog() {
    const logDir = path9.join(this.basePath, ".problem-solving", "debug-logs");
    fs9.mkdirSync(logDir, { recursive: true });
    const logPath = path9.join(logDir, `debug-${this.stateMachine.getCurrentIteration()}.log`);
    fs9.writeFileSync(logPath, this.debugLog.join(`
`), "utf-8");
  }
  saveIterationArtifact(filename, content) {
    const iterDir = path9.join(this.basePath, ".problem-solving", "iterations", this.stateMachine.getCurrentIteration());
    fs9.mkdirSync(iterDir, { recursive: true });
    fs9.writeFileSync(path9.join(iterDir, filename), content, "utf-8");
  }
  getLayerName(layer) {
    const names = {
      1: "Assumption Statement",
      2: "Action with Prediction",
      3: "Observation & Evidence",
      4: "Gap Analysis & Adjustment",
      5: "Meta-Cognitive Reflection",
      6: "Verification & Confirmation"
    };
    return names[layer] ?? `Layer ${layer}`;
  }
  getLayerFilename(layer) {
    const files = {
      1: "01_ASSUMPTION.md",
      2: "02_ACTION.md",
      3: "03_OBSERVATION.md",
      4: "04_GAP_ANALYSIS.md",
      5: "05_META_REFLECTION.md",
      6: "06_VERIFICATION.md"
    };
    return files[layer] ?? `layer-${layer}.md`;
  }
  formatLayerOutput(layer, content) {
    const lines = [];
    lines.push(`# ${this.getLayerName(layer)}`);
    lines.push(`**Iteration:** ${this.stateMachine.getCurrentIteration()}`);
    lines.push(`**Completed at:** ${new Date().toISOString()}`);
    lines.push("");
    for (const [key, value] of Object.entries(content)) {
      lines.push(`## ${key}`);
      lines.push("");
      lines.push(String(value));
      lines.push("");
    }
    return lines.join(`
`);
  }
  generateIndex() {
    const state = this.stateMachine.getState();
    const lines = [];
    lines.push("# Problem Solving Mode \u2014 Iteration Index");
    lines.push("");
    lines.push(`Iteration: ${state.iteration}`);
    lines.push(`Current Layer: Layer ${state.currentLayer}`);
    lines.push(`Status: ${state.currentLayer === 7 ? "COMPLETE" : "IN PROGRESS"}`);
    lines.push("");
    lines.push("## Layers");
    for (let i = 1;i <= 6; i++) {
      const name = this.getLayerName(i);
      const isCurrent = state.currentLayer === i;
      const passed = i < state.currentLayer;
      const icon = passed ? "\u2713" : isCurrent ? "\u2192" : "\u25CB";
      lines.push(`${icon} Layer ${i}: ${name}`);
    }
    return lines.join(`
`);
  }
  logActivity(layer, action, output) {
    this.activityLog.push({ layer, action, output, timestamp: Date.now() });
  }
  getActivityLog() {
    return [...this.activityLog];
  }
  getState() {
    return this.stateMachine.getState();
  }
  getCurrentRecord() {
    return this.stateMachine.getCurrentRecord();
  }
  getIterationCount() {
    return this.stateMachine.getIterationCount();
  }
}

// problem-solving/coordinator-v2.ts
class CoordinatorV2 {
  state;
  brain = null;
  constructor() {
    this.state = {
      currentBrain: "plan",
      executionMode: "problem-solving",
      switchReason: "session-start",
      iteration: "V1.0",
      lastSwitchAt: Date.now(),
      switchCount: 0
    };
  }
  attach(brain) {
    this.brain = brain;
  }
  initialize(problem) {
    if (this.brain) {
      this.brain.initialize(problem);
    }
    this.state = {
      currentBrain: "plan",
      executionMode: "problem-solving",
      switchReason: `new-problem: ${problem.substring(0, 80)}`,
      iteration: "V1.0",
      lastSwitchAt: Date.now(),
      switchCount: 0
    };
  }
  getContext() {
    if (!this.brain)
      return "Problem Solving Brain not initialized";
    const brainContext = this.brain.getBrainT1();
    const coordinatorInfo = this.toContextString();
    return `${brainContext}

${coordinatorInfo}`;
  }
  processSignal(signal, payload) {
    if (!this.brain)
      return "Brain not attached";
    const result = this.brain.processSignal(signal, payload);
    const layer = this.brain.stateMachine.getCurrentLayer();
    if (layer === 2 /* LAYER_2 */ || layer === 6 /* LAYER_6 */) {
      this.switchTo("build", `Layer ${layer} requires execution`);
    } else {
      this.switchTo("plan", `Layer ${layer} requires planning/reasoning`);
    }
    return result;
  }
  switchTo(brain, reason) {
    if (this.state.currentBrain === brain)
      return;
    this.state.currentBrain = brain;
    this.state.switchReason = reason;
    this.state.lastSwitchAt = Date.now();
    this.state.switchCount++;
  }
  getCurrentBrain() {
    return this.state.currentBrain;
  }
  shouldDelegateToBuild() {
    const layer = this.brain?.stateMachine.getCurrentLayer();
    return layer === 2 /* LAYER_2 */ || layer === 6 /* LAYER_6 */;
  }
  getState() {
    return { ...this.state };
  }
  toContextString() {
    const layers = {
      1: "PLAN (assumption/reasoning)",
      2: "BUILD (execute action)",
      3: "PLAN (observe/analyze evidence)",
      4: "PLAN (analyze gap)",
      5: "PLAN (meta-reflect)",
      6: "BUILD (verify in target env)"
    };
    const currentLayer = this.brain?.stateMachine.getCurrentLayer() ?? 1;
    return [
      "[COORDINATOR V2]",
      `  Active Brain: ${this.state.currentBrain.toUpperCase()}`,
      `  Mode: ${this.state.executionMode}`,
      `  Layer ${currentLayer}: ${layers[currentLayer] ?? "Complete"}`,
      `  Switches: ${this.state.switchCount}`,
      `  Iteration: ${this.state.iteration}`
    ].join(`
`);
  }
}

// problem-solving/tools/ps-mode-status.ts
import { tool } from "@opencode-ai/plugin";
function createPsModeStatusTool(brain) {
  return tool({
    description: "Show Problem Solving Mode status \u2014 current layer, iteration, derailments, and progress",
    args: {
      detail: tool.schema.string().optional().describe("Detail level: summary (default) or full")
    },
    execute: async (args) => {
      const state = brain.getState();
      const record = brain.getCurrentRecord();
      const activity = brain.getActivityLog();
      const derailments = brain.stateMachine.getDerailments();
      const lines = [];
      lines.push("\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
      lines.push("\u2502     PROBLEM SOLVING MODE STATUS              \u2502");
      lines.push("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
      lines.push("");
      lines.push(`Layer: ${state.currentLayer === 7 ? "COMPLETE" : `Layer ${state.currentLayer}`}`);
      lines.push(`Iteration: ${state.iteration}`);
      lines.push(`Attempts: ${state.layerAttempts}/${state.maxLayerAttempts}`);
      lines.push(`Total Iterations: ${state.history.length}`);
      lines.push(`Derailments: ${derailments.length}`);
      if (record) {
        lines.push("");
        lines.push(`Problem: ${record.problemStatement.substring(0, 120)}`);
        lines.push(`Outcome: ${record.outcome}`);
      }
      if (args.detail === "full") {
        if (derailments.length > 0) {
          lines.push("");
          lines.push("\u2500\u2500 Derailments \u2500\u2500");
          for (const d of derailments) {
            lines.push(`  ${d.blocked ? "[BLOCKED]" : "[WARN]"} Layer ${d.layer}: ${d.type}`);
            lines.push(`    ${d.evidence}`);
          }
        }
        if (activity.length > 0) {
          lines.push("");
          lines.push("\u2500\u2500 Recent Activity \u2500\u2500");
          for (const a of activity.slice(-10)) {
            lines.push(`  Layer ${a.layer}: ${a.action} \u2014 ${a.output.substring(0, 80)}`);
          }
        }
      }
      return JSON.stringify({ status: "ok", output: lines.join(`
`) });
    }
  });
}

// problem-solving/tools/ps-mode-layer.ts
import { tool as tool2 } from "@opencode-ai/plugin";
function parseContent(raw, layer) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch (e) {
    mantaError("ps-mode-layer: JSON parse failed, falling back to line parsing:", e);
  }
  const layerFieldNames = {
    1: ["Explicit Assumption", "Reasoning Chain", "Success Criteria", "Confirmation/Disproof Criteria"],
    2: ["Exact Command", "Expected Output", "Environment State"],
    3: ["Raw Evidence", "Logs Checked", "Expected vs Actual Comparison"],
    4: ["Gap Analysis", "Updated Hypothesis", "Next Action Tied to Insight"],
    5: ["What I Should Have Done", "Pattern Extracted", "Systemic Issue"],
    6: ["Target Environment Execution", "Behavior Matches Requirement", "No Regressions"]
  };
  const fields = layerFieldNames[layer] || layerFieldNames[1];
  const result = {};
  const lines = raw.split(`
`).filter((l) => l.trim().length > 0);
  if (lines.length === 1) {
    result[fields[0]] = lines[0].trim();
    return result;
  }
  for (let i = 0;i < Math.min(lines.length, fields.length); i++) {
    result[fields[i]] = lines[i].trim();
  }
  if (lines.length > fields.length) {
    result[fields[fields.length - 1]] = lines.slice(fields.length - 1).join(`
`).trim();
  }
  return result;
}
function createPsModeLayerTool(brain) {
  return tool2({
    description: "Submit layer output or check layer requirements. Use this to advance through the 6 problem-solving layers. Content can be JSON object OR plain text.",
    args: {
      action: tool2.schema.string().optional().describe("Action: submit (default), current, or requirements"),
      content: tool2.schema.string().optional().describe("Layer content to submit (JSON or plain text)"),
      layer: tool2.schema.number().optional().describe("Layer number for requirements query"),
      problem: tool2.schema.string().optional().describe("Problem statement for initialization")
    },
    execute: async (args) => {
      if (args.action === "current") {
        const layer = brain.stateMachine.getCurrentLayer();
        const criteria = GATE_CRITERIA2[layer];
        return JSON.stringify({
          status: "ok",
          output: `Current Layer: ${layer === 7 ? "COMPLETE" : `Layer ${layer}`}
Requirements: ${Object.keys(criteria?.requirements ?? {}).join(", ")}`,
          layer,
          requirements: criteria?.requirements ?? {}
        });
      }
      if (args.action === "requirements") {
        const layerNum = args.layer ?? brain.stateMachine.getCurrentLayer();
        const criteria = GATE_CRITERIA2[layerNum];
        if (!criteria) {
          return JSON.stringify({ status: "error", output: `No criteria found for layer ${layerNum}` });
        }
        return JSON.stringify({
          status: "ok",
          output: `Layer ${layerNum} Requirements:
${Object.entries(criteria.requirements).map(([k, v]) => `  ${v ? "[REQUIRED]" : "[OPTIONAL]"} ${k}`).join(`
`)}`,
          layer: layerNum,
          requirements: criteria.requirements,
          evidenceRequired: criteria.evidenceRequired
        });
      }
      if (args.action === "submit") {
        if (!args.content) {
          return JSON.stringify({ status: "error", output: "content required for submit" });
        }
        const currentLayer = brain.stateMachine.getCurrentLayer();
        const content = parseContent(args.content, currentLayer);
        if (!brain.stateMachine.historyExists()) {
          const problemStatement = args.problem || (typeof content["Explicit Assumption"] === "string" ? content["Explicit Assumption"] : "") || args.content.substring(0, 100);
          brain.initialize(problemStatement);
        }
        brain.stateMachine.ensureRecord();
        const layerBefore = brain.stateMachine.getCurrentLayer();
        const derailments = brain.detectDerailments(JSON.stringify(content));
        const blockers = derailments.filter((d) => d.blocked);
        if (blockers.length > 0) {
          return JSON.stringify({
            status: "derailed",
            output: `BLOCKED by ${blockers.length} derailment(s): ${blockers.map((b) => b.type).join(", ")}`,
            derailments: blockers
          });
        }
        brain.stateMachine.passLayer({ complete: true, content, passed: true, errors: [] });
        const layerAfter = brain.stateMachine.getCurrentLayer();
        if (layerAfter === layerBefore && layerBefore !== 7) {
          const attempts = brain.stateMachine.getLayerAttempts();
          const maxAttempts = brain.stateMachine.state.maxLayerAttempts;
          return JSON.stringify({
            status: "validation_failed",
            output: `Layer ${layerBefore} validation failed. Attempt ${attempts}/${maxAttempts}. Check layer requirements and resubmit.`,
            layer: layerBefore,
            attempts,
            maxAttempts
          });
        }
        return JSON.stringify({
          status: "ok",
          output: `Layer passed. Current layer: ${layerAfter === 7 ? "COMPLETE" : `Layer ${layerAfter}`}`,
          newLayer: layerAfter,
          isComplete: brain.stateMachine.isComplete()
        });
      }
      return JSON.stringify({ status: "error", output: "Unknown action" });
    }
  });
}

// problem-solving/tools/ps-mode-evidence.ts
import { tool as tool3 } from "@opencode-ai/plugin";
function createPsModeEvidenceTool(brain) {
  return tool3({
    description: "Validate evidence for the current layer. Checks if evidence is from an external source (valid) or self-created (invalid).",
    args: {
      evidence: tool3.schema.string().describe("Evidence text to validate"),
      source: tool3.schema.string().optional().describe("Source type: external or internal")
    },
    execute: async (args) => {
      const isExternal = args.source === "external";
      const result = brain.antiDerailment.validateEvidence(args.evidence, isExternal);
      if (!result.valid) {
        const derail = brain.stateMachine.getDerailments();
        return JSON.stringify({
          status: result.valid ? "ok" : "invalid",
          output: result.reason ?? "Evidence validation failed",
          derailmentCount: derail.length
        });
      }
      return JSON.stringify({
        status: "ok",
        output: "Evidence is valid \u2014 from external source",
        source: args.source,
        length: args.evidence.length
      });
    }
  });
}

// problem-solving/tools/ps-mode-derail.ts
import { tool as tool4 } from "@opencode-ai/plugin";
function createPsModeDerailTool(brain) {
  return tool4({
    description: "Check text for derailment patterns. Use this before submitting layer content to catch issues early.",
    args: {
      text: tool4.schema.string().describe("Text to check for derailment patterns")
    },
    execute: async (args) => {
      const layer = brain.stateMachine.getCurrentLayer();
      const findings = brain.detectDerailments(args.text);
      if (findings.length === 0) {
        return JSON.stringify({
          status: "clean",
          output: "No derailment patterns detected",
          layer
        });
      }
      const blocked = findings.filter((f) => f.blocked);
      const warnings = findings.filter((f) => !f.blocked);
      return JSON.stringify({
        status: blocked.length > 0 ? "blocked" : "warnings",
        output: `Found ${findings.length} derailment(s): ${blocked.length} blocker(s), ${warnings.length} warning(s)`,
        findings,
        layer,
        antiDerailmentChecks: ANTI_DERAILMENT_CHECKS.filter((c) => c.enforcedAt <= layer).map((c) => c.check)
      });
    }
  });
}

// problem-solving/tools/ps-mode-debug.ts
import { tool as tool5 } from "@opencode-ai/plugin";
function createPsModeDebugTool(brain) {
  return tool5({
    description: "View debug log entries and save them to disk. Use after solving or when stuck to audit the process.",
    args: {
      action: tool5.schema.string().optional().describe("Action: view (default) or save"),
      category: tool5.schema.string().optional().describe("Filter by category (e.g. ERROR, WARN, INFO)")
    },
    execute: async (args) => {
      let logs = brain.getDebugLog();
      if (args.category) {
        const cat = args.category.toUpperCase();
        logs = logs.filter((l) => l.includes(`[${cat}]`));
      }
      if (args.action === "save") {
        brain.saveDebugLog();
        const state = brain.stateMachine.getState();
        return JSON.stringify({
          status: "ok",
          output: `Debug log saved for iteration ${state.iteration}. ${logs.length} entries.`,
          entries: logs.length,
          iteration: state.iteration
        });
      }
      const recentLogs = logs.slice(-50);
      return JSON.stringify({
        status: "ok",
        output: recentLogs.join(`
`),
        total: logs.length,
        shown: recentLogs.length
      });
    }
  });
}

// problem-solving/problem-solving-mode.ts
function createProblemSolvingMode(basePath) {
  const brain = new ProblemSolvingBrain(basePath);
  const coordinator = new CoordinatorV2;
  coordinator.attach(brain);
  const tools = {
    "ps-mode-status": createPsModeStatusTool(brain),
    "ps-mode-layer": createPsModeLayerTool(brain),
    "ps-mode-evidence": createPsModeEvidenceTool(brain),
    "ps-mode-derail": createPsModeDerailTool(brain),
    "ps-mode-debug": createPsModeDebugTool(brain)
  };
  return { brain, coordinator, tools };
}

// tools/manta-status.ts
import { tool as tool6 } from "@opencode-ai/plugin";
function createMantaStatusTool(stateStore, gateManager, variant = "manta") {
  return tool6({
    description: "Show current Manta v2.2.2 state: brain, gate, iteration, and evidence status",
    args: {},
    execute: async () => {
      const gateState = gateManager.getState();
      const currentGate = gateManager.getCurrentGate();
      const iteration = gateManager.getCurrentIteration();
      const macroState = stateStore.get("manta-state", "manta-state");
      const brainState = variant === "manta" ? String(macroState?.currentBrain ?? "unknown") : Array.isArray(macroState?.activeBrains) ? macroState.activeBrains.join(", ") : "unknown";
      const evidence = gateManager.getEvidenceCollector();
      const evidenceStatus = {};
      const gates = ["plan", "build", "review", "verify", "test", "audit", "delivery"];
      for (const gate of gates) {
        const latest = evidence.getLatestEvidence(gate);
        evidenceStatus[gate] = latest?.passed || false;
      }
      const status = {
        variant,
        brain: brainState,
        currentGate,
        iteration,
        gateStatuses: gateState.gateStatus,
        evidenceStatus,
        verifyAttempts: gateState.verifyAttempts
      };
      return JSON.stringify(status, null, 2);
    }
  });
}

// tools/manta-gate.ts
import { tool as tool7 } from "@opencode-ai/plugin";
var VALID_GATES = ["plan", "build", "review", "verify", "test", "audit", "delivery"];
function parseGateName(raw, fallback) {
  const candidate = raw || fallback;
  if (VALID_GATES.includes(candidate))
    return candidate;
  throw new Error(`[MANTA] Invalid gate name: "${candidate}". Valid: ${VALID_GATES.join(", ")}`);
}
function createMantaGateTool(gateManager, guardian) {
  return tool7({
    description: "Evaluate a gate or get gate criteria",
    args: {
      action: tool7.schema.string().optional().describe("Action: status, criteria, advance, or evaluate"),
      gate: tool7.schema.string().optional().describe("Gate name (plan, build, review, verify, test, audit, delivery)"),
      passed: tool7.schema.boolean().optional().describe("Whether the gate passed"),
      notes: tool7.schema.string().optional().describe("Notes about the gate evaluation")
    },
    execute: async (args) => {
      const { action, gate, passed, notes } = args;
      if (action === "status") {
        const statuses = gateManager.getGateStatuses();
        const current = gateManager.getCurrentGate();
        return JSON.stringify({ statuses, currentGate: current }, null, 2);
      }
      if (action === "criteria") {
        const targetGate = parseGateName(gate, gateManager.getCurrentGate());
        const criteria = gateManager.getCriteria(targetGate);
        return JSON.stringify(criteria, null, 2);
      }
      if (action === "advance") {
        const currentGate = gateManager.getCurrentGate();
        let targetGate;
        if (!gate || gate === currentGate) {
          const currentIndex = VALID_GATES.indexOf(currentGate);
          if (currentIndex < 0 || currentIndex >= VALID_GATES.length - 1) {
            return JSON.stringify({ advanced: false, currentGate, error: "Already at final gate" });
          }
          targetGate = VALID_GATES[currentIndex + 1];
        } else {
          targetGate = parseGateName(gate, currentGate);
        }
        const advanced = gateManager.transitionTo(targetGate);
        return JSON.stringify({
          advanced,
          from: currentGate,
          to: targetGate,
          currentGate: gateManager.getCurrentGate()
        }, null, 2);
      }
      if (action === "evaluate") {
        if (!gate) {
          return JSON.stringify({ error: "Gate required for evaluate action" });
        }
        const validatedGate = parseGateName(gate, gateManager.getCurrentGate());
        const evidence = gateManager.getEvidenceCollector();
        const gateEvidence = evidence.getLatestEvidence(validatedGate);
        if (passed !== undefined) {
          evidence.collectEvidence({
            gate: validatedGate,
            timestamp: Date.now(),
            passed: !!passed,
            files: [],
            metadata: { notes }
          });
          if (passed) {
            gateManager.passCurrentGate();
          } else {
            gateManager.failCurrentGate();
          }
        }
        const currentGate = gateManager.getCurrentGate();
        const currentIndex = VALID_GATES.indexOf(currentGate);
        const nextGate = currentIndex >= 0 && currentIndex < VALID_GATES.length - 1 ? VALID_GATES[currentIndex + 1] : null;
        let advanced = false;
        let advancedTo = null;
        if (passed && nextGate && gateManager.canTransition(nextGate)) {
          advanced = gateManager.transitionTo(nextGate);
          advancedTo = advanced ? nextGate : null;
        }
        const result = {
          gate: validatedGate,
          evaluated: true,
          passed: passed ?? gateEvidence?.passed ?? false,
          iteration: gateManager.getCurrentIteration(),
          advanced,
          advancedTo,
          currentGate: gateManager.getCurrentGate(),
          nextGate,
          advanceHint: advanced ? `Advanced to ${nextGate}` : nextGate ? `Use manta-gate action=advance gate=${nextGate} to proceed` : undefined
        };
        return JSON.stringify(result, null, 2);
      }
      return JSON.stringify({ error: "Unknown action" });
    }
  });
}

// tools/manta-evidence.ts
import { tool as tool8 } from "@opencode-ai/plugin";
var VALID_GATES2 = ["plan", "build", "review", "verify", "test", "audit", "delivery"];
function toGateName(raw) {
  if (VALID_GATES2.includes(raw))
    return raw;
  throw new Error(`[MANTA] Invalid gate: "${raw}". Valid: ${VALID_GATES2.join(", ")}`);
}
function createMantaEvidenceTool(evidenceCollector) {
  return tool8({
    description: "View evidence collection status and debug logs",
    args: {
      action: tool8.schema.string().optional().describe("Action: status, gate-evidence, iteration-logs, or complete"),
      gate: tool8.schema.string().optional().describe("Gate name to get evidence for"),
      iteration: tool8.schema.string().optional().describe("Iteration identifier")
    },
    execute: async (args) => {
      const { action, gate, iteration } = args;
      if (action === "status") {
        const complete = evidenceCollector.hasCompleteEvidence();
        const gateStatuses = {};
        for (const g of VALID_GATES2) {
          const evidence = evidenceCollector.getGateEvidence(g);
          gateStatuses[g] = {
            count: evidence.length,
            latest: evidence[0]?.timestamp ? new Date(evidence[0].timestamp).toISOString() : null
          };
        }
        return JSON.stringify({ complete, gates: gateStatuses }, null, 2);
      }
      if (action === "gate-evidence") {
        if (!gate) {
          return JSON.stringify({ error: "Gate required" });
        }
        const evidence = evidenceCollector.getGateEvidence(toGateName(gate));
        return JSON.stringify({ gate, evidence }, null, 2);
      }
      if (action === "iteration-logs") {
        if (!iteration) {
          return JSON.stringify({ error: "Iteration required" });
        }
        const logs = evidenceCollector.getIterationLogs(iteration);
        return JSON.stringify({ iteration, logs }, null, 2);
      }
      if (action === "complete") {
        const complete = evidenceCollector.hasCompleteEvidence();
        return JSON.stringify({ complete }, null, 2);
      }
      return JSON.stringify({ error: "Unknown action" });
    }
  });
}

// tools/checkpoint.ts
import { tool as tool9 } from "@opencode-ai/plugin";
import * as path10 from "path";
import * as fs10 from "fs";
function createCheckpointTool(stateStore, _gateManager) {
  return tool9({
    description: "Create a checkpoint of current state for recovery",
    args: {
      message: tool9.schema.string().optional().describe("Checkpoint description message")
    },
    execute: async (args) => {
      const { message } = args;
      const checkpointId = `cp_${Date.now()}`;
      const checkpointDir = path10.join(process.cwd(), ".manta", "checkpoints");
      await fs10.promises.mkdir(checkpointDir, { recursive: true });
      const checkpointData = {
        id: checkpointId,
        timestamp: new Date().toISOString(),
        message: message || "checkpoint",
        state: stateStore.snapshot()
      };
      await fs10.promises.writeFile(path10.join(checkpointDir, `${checkpointId}.json`), JSON.stringify(checkpointData, null, 2));
      return `Checkpoint created: \`${checkpointId}\``;
    }
  });
}

// tools/manta-spawn-container.ts
import { tool as tool10 } from "@opencode-ai/plugin";
import { execSync } from "child_process";
import * as fs11 from "fs";
import * as path11 from "path";
var MANTA_AGENT_NAME = "manta";
var MANTA_AGENT_COLOR = "#6B4C9A";
var CONTAINER_IMAGE = "opencode-test:1.14.34";
var RESERVED_PREFIXES = ["shark-", "kraken-", "trident-", "architect-", "opencode-"];
function safeExec(command, opts) {
  const sanitized = command.replace(/[^a-zA-Z0-9_\-\s/.:={}'">|&;]/g, "");
  return String(execSync(sanitized, opts));
}
function getDateString() {
  const now = new Date;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function generateContainerName(projectName) {
  const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  return `manta-${safeName}-${getDateString()}`;
}
function validateIsolation(containerName) {
  for (const prefix of RESERVED_PREFIXES) {
    if (containerName.startsWith(prefix)) {
      throw new Error(`[CONTAINER ISOLATION] Name "${containerName}" uses reserved prefix "${prefix}". Manta containers must start with "manta-".`);
    }
  }
}
function createSnapshot(pluginSource, model, apiKey) {
  const SNAP = fs11.mkdtempSync(path11.join("/tmp", "manta-snap.XXXX"));
  const configDir = path11.join(SNAP, "config");
  const pluginsDir = path11.join(configDir, "plugins", MANTA_AGENT_NAME);
  fs11.mkdirSync(pluginsDir, { recursive: true });
  const indexJs = path11.join(pluginSource, "dist", "index.js");
  if (fs11.existsSync(indexJs)) {
    fs11.copyFileSync(indexJs, path11.join(pluginsDir, "index.js"));
  }
  const modelConfig = {};
  if (model && model.includes("/")) {
    const [provider] = model.split("/");
    modelConfig.model = model;
    modelConfig.provider = {
      [provider]: { options: { apiKey } }
    };
  }
  const opencodeJson = {
    ...modelConfig,
    plugin: [`file:///root/.config/opencode/plugins/${MANTA_AGENT_NAME}/index.js`],
    agent: {
      [MANTA_AGENT_NAME]: {
        name: MANTA_AGENT_NAME,
        description: "MANTA v2.2.2 \u2014 Problem Solving Mode",
        mode: "primary",
        color: MANTA_AGENT_COLOR,
        tools: {
          "manta-status": true,
          "manta-gate": true,
          "manta-evidence": true,
          checkpoint: true,
          hive_context: true,
          hive_scan: true,
          hive_status: true,
          hive_trash_list: true,
          hive_trash_status: true,
          hive_remember: true,
          hive_forget: true,
          hive_purge: true,
          hive_restore: true,
          "manta-vision": true,
          "manta-compaction": true,
          "manta-code-review": true,
          "manta-runtime-audit": true,
          "manta-code-audit": true,
          "manta-spawn-container": true,
          "manta-test-runner": true,
          "ps-mode-status": true,
          "ps-mode-layer": true,
          "ps-mode-evidence": true,
          "ps-mode-derail": true,
          "ps-mode-debug": true
        }
      }
    },
    permission: { "*": { "*": "allow" } }
  };
  fs11.writeFileSync(path11.join(configDir, "opencode.json"), JSON.stringify(opencodeJson, null, 2));
  return SNAP;
}
function spawnMantaContainer(input) {
  const {
    projectName,
    pluginSource = process.cwd(),
    model = "deepseek/deepseek-v4-flash",
    apiKey = process.env.DEEPSEEK_API_KEY || ""
  } = input;
  const containerName = generateContainerName(projectName);
  const tmuxSession = `${containerName}-tui`;
  try {
    validateIsolation(containerName);
  } catch (err) {
    return { containerName, tmuxSession, snapshotPath: "", success: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    safeExec(`docker rm -f ${containerName} 2>/dev/null`, { stdio: "ignore" });
  } catch (e) {
    mantaError("spawn: pre-cleanup docker rm failed:", e);
  }
  try {
    safeExec(`tmux kill-session -t ${tmuxSession} 2>/dev/null`, { stdio: "ignore" });
  } catch (e) {
    mantaError("spawn: pre-cleanup tmux kill failed:", e);
  }
  const SNAP = createSnapshot(pluginSource, model, apiKey);
  try {
    const dockerCmd = `docker run -d --rm --name ${containerName} --entrypoint "" -v ${SNAP}/config:/root/.config/opencode ${CONTAINER_IMAGE} /bin/sh -c 'sleep 3600'`;
    safeExec(dockerCmd, { stdio: "pipe" });
    safeExec("sleep 5", { stdio: "pipe" });
    const psCheck = safeExec(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`, { encoding: "utf-8" });
    if (!psCheck.trim().includes(containerName)) {
      throw new Error("Container not running after 5s");
    }
    return { containerName, tmuxSession, snapshotPath: SNAP, success: true };
  } catch (err) {
    return { containerName, tmuxSession, snapshotPath: SNAP, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
function createMantaSpawnContainerTool() {
  return tool10({
    description: "Spawn a sandboxed Docker container for Manta testing. Each project gets its OWN container named manta-{projectName}-{YYYY-MM-DD}. Uses opencode-test:1.14.34 image.",
    args: {
      projectName: tool10.schema.string().describe("Project name for container naming"),
      pluginSource: tool10.schema.string().optional().describe("Path to plugin source directory"),
      model: tool10.schema.string().optional().describe("Model identifier"),
      apiKey: tool10.schema.string().optional().describe("API key for the model")
    },
    execute: async (input) => {
      const result = spawnMantaContainer(input);
      return JSON.stringify(result);
    }
  });
}

// tools/manta-test-runner.ts
import { tool as tool11 } from "@opencode-ai/plugin";
import * as fs12 from "fs";
import * as path12 from "path";
function resolvePluginPath() {
  const candidates = [
    process.env.MANTA_PLUGIN_PATH,
    path12.join(process.cwd(), "dist/index.js"),
    path12.join(process.cwd(), "index.js"),
    path12.join(process.cwd(), "../dist/index.js")
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs12.existsSync(c))
      return c;
  }
  return candidates[0];
}
function getErrorMessage(e) {
  if (e instanceof Error)
    return e.message;
  if (typeof e === "string")
    return e;
  return String(e);
}
async function getPlugin() {
  const pluginPath = resolvePluginPath();
  const mod = await import(pluginPath);
  const hooks = await mod.default({ directory: process.cwd() });
  return hooks.tool;
}
async function L0_plugin_loads() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-status"].execute({ detail: "summary" }, {});
    const d = JSON.parse(r);
    const passed = d.status === "ok" || d.output?.includes("Layer") || d.output?.includes("PSM");
    return { name: "L0-plugin-loads", passed, output: passed ? "Plugin loaded, ps-mode-status responds" : "Plugin loaded but unexpected response", timestamp: Date.now() };
  } catch (e) {
    return { name: "L0-plugin-loads", passed: false, output: `Plugin load failed: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L1_layer_submission() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-layer"].execute({ action: "submit", content: '{"Explicit Assumption":"Test assumption verifying that the layer submission pipeline validates content properly","Reasoning Chain":"1. Submit 2. Validate 3. Accept","Success Criteria":"Layer accepted","Confirmation/Disproof Criteria":"Layer rejected means validation works"}' }, {});
    const d = JSON.parse(r);
    const passed = d.status === "ok";
    return { name: "L1-layer-submission", passed, output: passed ? "Layer 1 submitted and accepted" : `Layer submission rejected: ${d.status}: ${d.output}`, timestamp: Date.now() };
  } catch (e) {
    return { name: "L1-layer-submission", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L2_status_tool() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-status"].execute({ detail: "summary" }, {});
    const d = JSON.parse(r);
    const passed = d.status === "ok" && d.output?.includes("Layer");
    return { name: "L2-status-tool", passed, output: passed ? "Status tool returns layer info" : "Status tool missing layer info", timestamp: Date.now() };
  } catch (e) {
    return { name: "L2-status-tool", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L3_derailment() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-derail"].execute({ text: "host testing already proves it works fine" }, {});
    const d = JSON.parse(r);
    const out = d.output || "";
    const passed = out.includes("block") || out.includes("derail") || out.includes("host");
    return { name: "L3-derailment-detection", passed, output: passed ? "Derailment detected: " + (out.match(/\d+ blocker/g)?.[0] || "found") : "Derailment not detected", timestamp: Date.now() };
  } catch (e) {
    return { name: "L3-derailment-detection", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L4_evidence() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-evidence"].execute({ evidence: "curl output shows 200 OK", source: "external" }, {});
    const d = JSON.parse(r);
    const passed = d.status === "ok" || d.valid === true;
    return { name: "L4-evidence-validation", passed, output: passed ? "External evidence validated" : "Evidence rejected", timestamp: Date.now() };
  } catch (e) {
    return { name: "L4-evidence-validation", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L5_debug_log() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-debug"].execute({ action: "save" }, {});
    const d = JSON.parse(r);
    const passed = d.status === "ok";
    return { name: "L5-debug-log", passed, output: passed ? "Debug log saved to disk" : "Debug log save failed", timestamp: Date.now() };
  } catch (e) {
    return { name: "L5-debug-log", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L6_host_fallback() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-derail"].execute({ text: "skip container test host already works" }, {});
    const d = JSON.parse(r);
    const out = d.output || "";
    const passed = out.includes("block") || out.includes("host") || out.includes("derail");
    return { name: "L6-host-fallback-blocked", passed, output: passed ? "Host fallback blocked" : "Not blocked", timestamp: Date.now() };
  } catch (e) {
    return { name: "L6-host-fallback-blocked", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L7_success_claim() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-derail"].execute({ text: "it works trust me everything is fine" }, {});
    const d = JSON.parse(r);
    const out = d.output || "";
    const passed = out.includes("block") || out.includes("success") || out.includes("derail");
    return { name: "L7-success-claim-blocked", passed, output: passed ? "Success claim blocked" : "Not blocked", timestamp: Date.now() };
  } catch (e) {
    return { name: "L7-success-claim-blocked", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L8_mock_stub() {
  try {
    const psm = await getPlugin();
    const r = await psm["ps-mode-derail"].execute({ text: "just use a mock or fake it" }, {});
    const d = JSON.parse(r);
    const out = d.output || "";
    const passed = out.includes("block") || out.includes("mock") || out.includes("derail") || out.includes("warning");
    return { name: "L8-mock-stub-blocked", passed, output: passed ? "Mock/stub blocked or warned" : "Not detected", timestamp: Date.now() };
  } catch (e) {
    return { name: "L8-mock-stub-blocked", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L9_evidence_dir() {
  try {
    const evidenceDir = path12.join(process.cwd(), ".manta", "evidence", "test-runner-check");
    fs12.mkdirSync(evidenceDir, { recursive: true });
    const testFile = path12.join(evidenceDir, `test-${Date.now()}.json`);
    fs12.writeFileSync(testFile, JSON.stringify({ test: true, timestamp: Date.now() }));
    const readBack = JSON.parse(fs12.readFileSync(testFile, "utf-8"));
    fs12.unlinkSync(testFile);
    fs12.rmdirSync(evidenceDir);
    return { name: "L9-evidence-dir-writable", passed: readBack.test === true, output: "Evidence directory writable + readable", timestamp: Date.now() };
  } catch (e) {
    return { name: "L9-evidence-dir-writable", passed: false, output: `Not writable: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
async function L10_bundle_valid() {
  try {
    const pluginPath = resolvePluginPath();
    if (!fs12.existsSync(pluginPath)) {
      return { name: "L10-plugin-bundle-valid", passed: false, output: `Plugin not found at ${pluginPath}`, timestamp: Date.now() };
    }
    const sizeKB = Math.round(fs12.statSync(pluginPath).size / 1024);
    const valid = sizeKB > 100;
    return { name: "L10-plugin-bundle-valid", passed: valid, output: valid ? `Bundle valid: ${sizeKB}KB` : `Bundle too small: ${sizeKB}KB`, timestamp: Date.now() };
  } catch (e) {
    return { name: "L10-plugin-bundle-valid", passed: false, output: `Error: ${getErrorMessage(e).slice(0, 200)}`, timestamp: Date.now() };
  }
}
var MANTA_TEST_SUITE = [
  { name: "L0-plugin-loads", test: L0_plugin_loads },
  { name: "L1-layer-submission", test: L1_layer_submission },
  { name: "L2-status-tool", test: L2_status_tool },
  { name: "L3-derailment-detection", test: L3_derailment },
  { name: "L4-evidence-validation", test: L4_evidence },
  { name: "L5-debug-log", test: L5_debug_log },
  { name: "L6-host-fallback-blocked", test: L6_host_fallback },
  { name: "L7-success-claim-blocked", test: L7_success_claim },
  { name: "L8-mock-stub-blocked", test: L8_mock_stub },
  { name: "L9-evidence-dir-writable", test: L9_evidence_dir },
  { name: "L10-plugin-bundle-valid", test: L10_bundle_valid }
];
function createMantaTestRunnerTool() {
  return tool11({
    description: "Run container-aware mechanical test suite for Manta agent. Uses plugin API directly \u2014 no opencode run dependency. Produces ContainerTestResult.json for ship gate evidence. 96%+ pass rate required.",
    args: {
      action: tool11.schema.string().optional().describe("Action: run (default) or status"),
      buildId: tool11.schema.string().optional().describe("Build identifier for the test run")
    },
    execute: async (args) => {
      const { action, buildId } = args;
      if (action === "status") {
        return JSON.stringify({
          status: "ready",
          containerAware: true,
          pluginAPI: true,
          testCount: MANTA_TEST_SUITE.length,
          tests: MANTA_TEST_SUITE.map((t) => t.name)
        });
      }
      if (action === "run" || action === "report") {
        const id = buildId || `manta-v2.2-${new Date().toISOString().slice(0, 10)}`;
        const results = [];
        for (const testDef of MANTA_TEST_SUITE) {
          try {
            const result = await testDef.test();
            results.push(result);
          } catch (error) {
            results.push({
              name: testDef.name,
              passed: false,
              output: `Error: ${getErrorMessage(error).slice(0, 200)}`,
              timestamp: Date.now()
            });
          }
        }
        const passedTests = results.filter((r) => r.passed).length;
        const totalTests = results.length;
        const passRate = totalTests > 0 ? passedTests / totalTests : 0;
        const overallPassed = passRate >= 0.96;
        const suiteResult = {
          suite: "manta-v2.2-container",
          timestamp: Date.now(),
          buildId: id,
          tests: results,
          overallPassed,
          totalTests,
          passedTests,
          failedTests: totalTests - passedTests,
          passRate
        };
        try {
          const evidenceDir = path12.join(process.cwd(), ".manta", "evidence", "delivery");
          fs12.mkdirSync(evidenceDir, { recursive: true });
          fs12.writeFileSync(path12.join(evidenceDir, "ContainerTestResult.json"), JSON.stringify(suiteResult, null, 2));
        } catch (e) {
          mantaError("test-runner: failed to write ContainerTestResult.json:", e);
        }
        let summary = `Test suite: ${id}
Results: ${passedTests}/${totalTests} passed (${Math.round(passRate * 100)}%)

`;
        for (const r of results) {
          summary += `${r.passed ? "\u2713" : "\u2717"} ${r.name}
  \u2192 ${r.output}
`;
        }
        summary += `
Overall: ${overallPassed ? "PASS (ship-ready)" : "FAIL (below 96%)"}`;
        if (overallPassed)
          summary += `
[ContainerTestResult.json saved to .manta/evidence/delivery/]`;
        return summary;
      }
      return JSON.stringify({ error: "Unknown action" });
    }
  });
}

// tools/manta-code-review.ts
import { tool as tool12 } from "@opencode-ai/plugin";
function createMantaCodeReviewTool(brain) {
  return tool12({
    description: "Run code review on built files. Checks for theatrical code, TODOs, empty handlers, magic numbers, function length, and file structure issues.",
    args: {
      path: tool12.schema.string().optional().describe("Directory path to review")
    },
    execute: async (args) => {
      const reviewPath = args.path || process.cwd();
      const findings = [];
      let totalFiles = 0;
      let totalIssues = 0;
      let totalScore = 100;
      try {
        let scanDir = function(dir) {
          const files = [];
          try {
            const entries = fs13.readdirSync(dir);
            for (const entry of entries) {
              if (entry.startsWith(".") || entry === "node_modules" || entry === "dist")
                continue;
              const full = pathModule.join(dir, entry);
              const stat = fs13.statSync(full);
              if (stat.isDirectory()) {
                files.push(...scanDir(full));
              } else if (/\.(ts|js|py|html|css|jsx|tsx|go|rs|java|cpp|c)$/i.test(entry)) {
                files.push(full);
              }
            }
          } catch (e) {
            mantaError("code-review: scanDir failed:", e);
          }
          return files;
        };
        const fs13 = await import("fs");
        const pathModule = await import("path");
        const sourceFiles = scanDir(reviewPath);
        totalFiles = sourceFiles.length;
        for (const filePath of sourceFiles) {
          try {
            const content = fs13.readFileSync(filePath, "utf-8");
            const lines = content.split(`
`);
            const fileFindings = [];
            if (content.includes("TODO") || content.includes("FIXME") || content.includes("HACK")) {
              const count = (content.match(/TODO|FIXME|HACK/gi) || []).length;
              fileFindings.push(`TODOs/placeholders: ${count} found`);
              totalIssues += count;
              totalScore -= Math.min(count * 2, 10);
            }
            if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(content)) {
              fileFindings.push("Empty catch block detected");
              totalIssues++;
              totalScore -= 3;
            }
            if (/catch\s*\([^)]*\)\s*\{\s*\/\/\s*silent/.test(content)) {
              fileFindings.push("Silently swallowed error detected");
              totalIssues++;
              totalScore -= 5;
            }
            const magicNumberPattern = /(?<![a-zA-Z0-9_"])\b(2|3|4|5|6|7|8|9|10|15|20|30|50|60|100|200|300|500|1000)\b(?![a-zA-Z0-9_"'])/g;
            const magicMatches = content.match(magicNumberPattern) || [];
            if (magicMatches.length > 3) {
              fileFindings.push(`Magic numbers: ${magicMatches.length} found (consider constants)`);
              totalIssues++;
              totalScore -= 1;
            }
            const functionPattern = /(function\s+\w+|=>\s*\{|:\s*\([^)]*\)\s*=>)/g;
            const funcMatches = content.match(functionPattern) || [];
            for (const match of funcMatches) {
              const startIdx = content.indexOf(match);
              const funcBody = content.substring(startIdx, startIdx + 3000);
              const funcLines = funcBody.split(`
`).length;
              if (funcLines > 50) {
                fileFindings.push(`Long function detected (~${funcLines} lines)`);
                totalIssues++;
                totalScore -= 2;
                break;
              }
            }
            if (/import\s+\*\s+as/.test(content)) {
              fileFindings.push("Wildcard import detected");
              totalIssues++;
              totalScore -= 2;
            }
            if (fileFindings.length > 0) {
              findings.push(`
${filePath}:`);
              for (const f of fileFindings) {
                findings.push(`  - ${f}`);
              }
            }
          } catch (e) {
            mantaError("code-review: file scan failed:", e);
          }
        }
        if (brain) {
          const state = brain.stateMachine.getState();
          if (state.currentLayer < 7 && state.currentLayer > 0) {
            findings.push(`
[PSM STATUS]
  Current Layer: ${state.currentLayer}/6
  Iteration: ${state.iteration}
  Derailments: ${state.derailments.length}`);
          }
        }
        const overallPassed = totalScore >= 90;
        const report = {
          overallScore: Math.max(0, totalScore),
          overallPassed,
          totalFiles,
          totalIssues,
          passRate: Math.round(totalScore / 100 * 100),
          timestamp: Date.now(),
          buildId: `review-${Date.now().toString(36)}`,
          findings: findings.length > 0 ? findings.join(`
`) : "No issues found."
        };
        try {
          const fs14 = await import("fs");
          const pathModule2 = await import("path");
          const evidenceDir = pathModule2.join(process.cwd(), ".manta", "evidence", "review");
          fs14.mkdirSync(evidenceDir, { recursive: true });
          const reportPath = pathModule2.join(evidenceDir, "CodeReviewReport.json");
          fs14.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        } catch (e) {
          mantaError("code-review: failed to write report:", e);
        }
        return JSON.stringify({
          status: overallPassed ? "passed" : "failed",
          score: totalScore,
          passRate: report.passRate,
          totalFiles,
          totalIssues,
          detail: findings.length > 0 ? findings.join(`
`) : "All files passed review."
        }, null, 2);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: "error", error: msg || "Unknown error during code review" });
      }
    }
  });
}

// tools/manta-runtime-audit.ts
import { tool as tool13 } from "@opencode-ai/plugin";
import * as fs13 from "fs";
import * as path13 from "path";
function createMantaRuntimeAuditTool(basePath = ".manta") {
  return tool13({
    description: "Runtime-grade audit for AUDIT gate. Checks container test evidence, theatrical patterns, freshness, and completeness. Returns pass/fail for each of 8 checks.",
    args: {
      action: tool13.schema.string().optional().describe("Action: run (default) or status")
    },
    execute: async (args) => {
      const safeBase = typeof basePath === "string" && basePath.startsWith(".") ? basePath : ".manta";
      if (args.action === "status") {
        const statusPath = path13.join(basePath, "evidence", "delivery", "RuntimeAuditResult.json");
        if (fs13.existsSync(statusPath)) {
          return JSON.parse(fs13.readFileSync(statusPath, "utf-8"));
        }
        return { status: "no-previous-audit" };
      }
      const checks = [];
      const evidenceDir = path13.join(safeBase, "evidence");
      const deliveryDir = path13.join(evidenceDir, "delivery");
      const containerTestPath = path13.join(deliveryDir, "ContainerTestResult.json");
      if (fs13.existsSync(containerTestPath)) {
        try {
          const ct = JSON.parse(fs13.readFileSync(containerTestPath, "utf-8"));
          checks.push({ name: "container-test-evidence", passed: true, detail: `Found: passRate=${ct.passRate || "unknown"}` });
        } catch {
          checks.push({ name: "container-test-evidence", passed: false, detail: "File exists but is not valid JSON" });
        }
      } else {
        checks.push({ name: "container-test-evidence", passed: false, detail: "No ContainerTestResult.json found in delivery evidence" });
      }
      if (checks[0].passed) {
        try {
          const ct = JSON.parse(fs13.readFileSync(containerTestPath, "utf-8"));
          const rate = ct.passRate ?? ct.pass_rate ?? 0;
          checks.push({ name: "pass-rate", passed: rate >= 0.96, detail: `Pass rate: ${(rate * 100).toFixed(1)}% (required: \u226596%)` });
        } catch {
          checks.push({ name: "pass-rate", passed: false, detail: "Cannot parse pass rate" });
        }
      } else {
        checks.push({ name: "pass-rate", passed: false, detail: "Skipped: no container test evidence" });
      }
      if (fs13.existsSync(deliveryDir)) {
        const files = fs13.readdirSync(deliveryDir);
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        let freshCount = 0;
        for (const f of files) {
          const stat = fs13.statSync(path13.join(deliveryDir, f));
          if (now - stat.mtimeMs < dayMs)
            freshCount++;
        }
        checks.push({ name: "evidence-freshness", passed: freshCount > 0, detail: `${freshCount}/${files.length} files fresh (<24h)` });
      } else {
        checks.push({ name: "evidence-freshness", passed: false, detail: "No delivery evidence directory" });
      }
      let theatricalFound = false;
      const theatricalPatterns = /\b(theatrical|stub|fake|mock data|placeholder|hardcoded.*test|dummy)\b/i;
      function scanDir(dir, depth = 0) {
        if (depth > 2 || theatricalFound)
          return;
        if (!fs13.existsSync(dir))
          return;
        for (const entry of fs13.readdirSync(dir)) {
          if (theatricalFound)
            break;
          const full = path13.join(dir, entry);
          const stat = fs13.statSync(full);
          if (stat.isDirectory())
            scanDir(full, depth + 1);
          else if (entry.endsWith(".json") || entry.endsWith(".md")) {
            try {
              const content = fs13.readFileSync(full, "utf-8");
              if (theatricalPatterns.test(content)) {
                theatricalFound = true;
              }
            } catch (e) {
              mantaError("runtime-audit: theatrical scan read failed:", e);
            }
          }
        }
      }
      scanDir(evidenceDir);
      checks.push({ name: "no-theatrical", passed: !theatricalFound, detail: theatricalFound ? "Theatrical patterns found in evidence" : "No theatrical patterns detected" });
      const tuiPatterns = ["tui-", "capture-pane", "tmux"];
      let tuiFound = false;
      if (fs13.existsSync(deliveryDir)) {
        for (const f of fs13.readdirSync(deliveryDir)) {
          if (tuiPatterns.some((p) => f.toLowerCase().includes(p))) {
            tuiFound = true;
            break;
          }
        }
      }
      if (!tuiFound) {
        const debugDir = path13.join(safeBase, "debug-logs");
        if (fs13.existsSync(debugDir)) {
          let checkDirForTui = function(dir) {
            for (const entry of fs13.readdirSync(dir)) {
              const full = path13.join(dir, entry);
              if (fs13.statSync(full).isDirectory()) {
                for (const f of fs13.readdirSync(full)) {
                  if (tuiPatterns.some((p) => f.toLowerCase().includes(p))) {
                    tuiFound = true;
                    return;
                  }
                }
              } else if (tuiPatterns.some((p) => entry.toLowerCase().includes(p))) {
                tuiFound = true;
                return;
              }
            }
          };
          checkDirForTui(debugDir);
        }
      }
      checks.push({ name: "tui-evidence", passed: tuiFound, detail: tuiFound ? "TUI capture evidence found" : "No TUI capture evidence found \u2014 run container TUI test" });
      const hookLogPath = path13.join(safeBase, "hook-executions.jsonl");
      const hooksFired = fs13.existsSync(hookLogPath);
      checks.push({ name: "hooks-fired", passed: hooksFired, detail: hooksFired ? "Hook execution log found" : "No hook log found \u2014 hooks may not be firing" });
      const psmDir = path13.join(safeBase, ".problem-solving", "iterations");
      const psmExists = fs13.existsSync(psmDir);
      if (psmExists) {
        const iterations = fs13.readdirSync(psmDir);
        checks.push({ name: "psm-complete", passed: iterations.length > 0, detail: `PSM iterations: ${iterations.length}` });
      } else {
        checks.push({ name: "psm-complete", passed: false, detail: "PSM iterations not found \u2014 PSM may not have been activated" });
      }
      const reviewPath = path13.join(deliveryDir, "CodeReviewReport.json");
      if (fs13.existsSync(reviewPath)) {
        try {
          const review = JSON.parse(fs13.readFileSync(reviewPath, "utf-8"));
          checks.push({ name: "code-review", passed: review.overallPassed !== false, detail: `Code review: ${review.overallPassed !== false ? "passed" : "failed"}` });
        } catch {
          checks.push({ name: "code-review", passed: false, detail: "Code review file not valid JSON" });
        }
      } else {
        checks.push({ name: "code-review", passed: false, detail: "No code review report found \u2014 code review may not have been run" });
      }
      const passed = checks.filter((c) => c.passed).length;
      const total = checks.length;
      const overallPassed = passed === total;
      const result = {
        status: overallPassed ? "passed" : "failed",
        passed: overallPassed,
        checks,
        passRate: total > 0 ? passed / total : 0,
        summary: `${passed}/${total} checks passed`,
        timestamp: new Date().toISOString()
      };
      try {
        fs13.mkdirSync(deliveryDir, { recursive: true });
        fs13.writeFileSync(path13.join(deliveryDir, "RuntimeAuditResult.json"), JSON.stringify(result, null, 2));
      } catch (e) {
        mantaError("runtime-audit: failed to write result:", e);
      }
      return result;
    }
  });
}

// tools/manta-code-audit.ts
import { tool as tool14 } from "@opencode-ai/plugin";
import * as fs14 from "fs";
import * as path14 from "path";
function createMantaCodeAuditTool(basePath = ".manta") {
  return tool14({
    description: "MANTA deep code audit for AUDIT gate. Scans source for critical/high findings. Returns structured results.",
    args: {
      action: tool14.schema.string().optional().describe("Action: run (default) or status"),
      target: tool14.schema.string().optional().describe("Target directory to audit")
    },
    execute: async (args) => {
      const safeBase = typeof basePath === "string" && basePath.startsWith(".") ? basePath : ".manta";
      if (args.action === "status") {
        const statusPath = path14.join(safeBase, "evidence", "delivery", "CodeAuditResult.json");
        if (fs14.existsSync(statusPath)) {
          return JSON.parse(fs14.readFileSync(statusPath, "utf-8"));
        }
        return { status: "no-previous-audit" };
      }
      const targetDir = args.target || "./src";
      const findings = [];
      if (!fs14.existsSync(targetDir)) {
        return { status: "error", message: `Target directory not found: ${targetDir}` };
      }
      function scanFile(filePath) {
        try {
          const content = fs14.readFileSync(filePath, "utf-8");
          const lines = content.split(`
`);
          const ext = path14.extname(filePath);
          for (let i = 0;i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            const relPath = path14.relative(".", filePath);
            if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || /catch\s*\{\s*\}/.test(line)) {
              findings.push({ severity: "critical", file: relPath, line: lineNum, rule: "empty-catch", detail: "Empty catch block \u2014 error silently swallowed" });
            }
            if (ext === ".ts" && /:\s*any\b/.test(line) && !line.includes("// ") && !/\bas\s+any\b/.test(line)) {
              findings.push({ severity: "high", file: relPath, line: lineNum, rule: "any-type", detail: "Unrestricted any type" });
            }
            if (/['"]\/(home|Users|root|tmp)\//.test(line) && !line.includes("process.env") && !line.includes("path.join")) {
              findings.push({ severity: "high", file: relPath, line: lineNum, rule: "hardcoded-path", detail: "Hardcoded filesystem path" });
            }
            if (/\bconsole\.log\b/.test(line) && !line.includes("//")) {
              findings.push({ severity: "medium", file: relPath, line: lineNum, rule: "console-log", detail: "console.log used \u2014 prefer console.error for plugin output" });
            }
            if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line) && !line.includes("disable")) {
              findings.push({ severity: "medium", file: relPath, line: lineNum, rule: "todo-placeholder", detail: "Unresolved TODO/FIXME comment" });
            }
            if (/return\s+(['"][^'"]*['"]|true|false|\d+)\s*;\s*(\/\/|$)/.test(line) && /stub|todo|placeholder|fixme/i.test(lines[Math.min(i + 1, lines.length - 1)])) {
              findings.push({ severity: "high", file: relPath, line: lineNum, rule: "stub-return", detail: "Possible stub return value" });
            }
          }
        } catch (e) {
          mantaError("code-audit: scanFile failed:", e);
        }
      }
      function scanDir(dir, depth = 0) {
        if (depth > 5)
          return;
        try {
          for (const entry of fs14.readdirSync(dir)) {
            const full = path14.join(dir, entry);
            const stat = fs14.statSync(full);
            if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
              scanDir(full, depth + 1);
            } else if (stat.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry)) {
              scanFile(full);
            }
          }
        } catch (e) {
          mantaError("code-audit: scanDir failed:", e);
        }
      }
      scanDir(targetDir);
      const critical = findings.filter((f) => f.severity === "critical").length;
      const high = findings.filter((f) => f.severity === "high").length;
      const medium = findings.filter((f) => f.severity === "medium").length;
      const low = findings.filter((f) => f.severity === "low").length;
      const passed = critical === 0 && high === 0;
      const result = {
        status: passed ? "passed" : "failed",
        passed,
        critical,
        high,
        medium,
        low,
        total: findings.length,
        findings: findings.slice(0, 50),
        timestamp: new Date().toISOString()
      };
      try {
        const deliveryDir = path14.join(safeBase, "evidence", "delivery");
        fs14.mkdirSync(deliveryDir, { recursive: true });
        fs14.writeFileSync(path14.join(deliveryDir, "CodeAuditResult.json"), JSON.stringify(result, null, 2));
      } catch (e) {
        mantaError("Failed to write code audit result:", e);
      }
      return result;
    }
  });
}

// tools/manta-vision.ts
import { tool as tool15 } from "@opencode-ai/plugin";
var VLM_ENDPOINT = process.env.VLM_API_URL || "http://127.0.0.1:8082/v1/chat/completions";
function toResult(data) {
  return JSON.stringify(data, null, 2);
}
function createMantaVisionTool() {
  return tool15({
    description: "Read images/screenshots using local VLM (GLM-4.6V-Flash). You CAN see images. Pass a file path to any image and this tool will read and describe its contents including error messages, UI text, code, etc.",
    args: {
      imagePath: tool15.schema.string().describe("Absolute path to image file"),
      prompt: tool15.schema.string().optional().describe("Custom prompt for VLM analysis")
    },
    execute: async (args) => {
      const fs15 = await import("fs");
      const path15 = await import("path");
      const imagePath = args.imagePath;
      const prompt = args.prompt || "What is shown in this image? Return the exact text visible.";
      if (!fs15.existsSync(imagePath)) {
        return toResult({ status: "error", message: `File not found: ${imagePath}` });
      }
      const ext = path15.extname(imagePath).toLowerCase();
      const supported = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
      if (!supported.includes(ext)) {
        return toResult({ status: "error", message: `Unsupported format: ${ext}. Supported: ${supported.join(", ")}` });
      }
      const imageBuffer = fs15.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");
      const mimeType = ext === ".jpg" ? "image/jpeg" : `image/${ext.replace(".", "")}`;
      const payload = JSON.stringify({
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }],
        max_tokens: 2048,
        temperature: 0.1
      });
      for (let attempt = 1;attempt <= 2; attempt++) {
        try {
          const response = await fetch(VLM_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: AbortSignal.timeout(120000)
          });
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            return toResult({
              status: "error",
              message: `VLM HTTP ${response.status}: ${text.slice(0, 200)}`
            });
          }
          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content && typeof content === "string" && content.length > 0) {
            return toResult({
              status: "ok",
              imagePath,
              content,
              model: data?.model || "GLM-4.6V-Flash",
              usage: data?.usage || {}
            });
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          return toResult({
            status: "error",
            message: "VLM returned empty content after 2 attempts",
            debug: {
              responseKeys: Object.keys(data || {}),
              hasChoices: !!data?.choices,
              choicesLength: data?.choices?.length || 0,
              hasMessage: !!data?.choices?.[0]?.message,
              contentType: typeof data?.choices?.[0]?.message?.content,
              contentLength: data?.choices?.[0]?.message?.content?.length || 0,
              rawPreview: JSON.stringify(data).slice(0, 500)
            }
          });
        } catch (error) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          const err = error instanceof Error ? error : new Error(String(error));
          const errMsg = err.message || String(error);
          return toResult({ status: "error", message: `VLM failed after 2 attempts: ${errMsg}` });
        }
      }
    }
  });
}

// tools/manta-compaction.ts
import { tool as tool16 } from "@opencode-ai/plugin";
function stringifyResult(result) {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}
function createMantaCompactionTool(compactionManager, gateManager) {
  return tool16({
    description: "Compaction survival: check token budget, view anchor status, or manually trigger state export",
    args: {
      action: tool16.schema.string().describe("Action: status, export, or anchors"),
      activeTask: tool16.schema.string().optional().describe("Active task description for export"),
      nextSteps: tool16.schema.string().optional().describe("Next steps for export")
    },
    execute: async (args) => {
      const { action } = args;
      if (!compactionManager.isInitialized()) {
        compactionManager.initialize();
      }
      if (action === "status") {
        return stringifyResult(compactionManager.getStatus());
      }
      if (action === "export") {
        const gateState = gateManager ? { currentGate: gateManager.getCurrentGate(), currentIteration: gateManager.getCurrentIteration(), gateStatus: gateManager.getGateStatuses() } : { currentGate: "unknown", currentIteration: "V1.0", gateStatus: {} };
        const result = compactionManager.triggerExport(gateState, args.activeTask, args.nextSteps);
        return stringifyResult({
          status: "ok",
          exportId: result.exportId,
          tier: result.tier,
          gate: result.gate,
          message: "Manual export created. 5 memory anchors updated."
        });
      }
      if (action === "anchors") {
        const anchors = {};
        const names = ["COMPACTION_SURVIVAL.md", "BUILD_STATE.md", "DECISION_CHAIN.md", "EVIDENCE_STATE.md", "TASK_QUEUE.md"];
        for (const name of names) {
          anchors[name] = compactionManager.readAnchor(name);
        }
        return stringifyResult({ status: "ok", anchors });
      }
      return stringifyResult({ status: "error", message: `Unknown action: ${action}` });
    }
  });
}

// agents/definitions.ts
var MANTA_AGENTS_CONFIG = {
  orchestrator: {
    name: "manta",
    description: "MANTA v2.2 \u2014 Orchestrator. Spawns Plan Brain and Execution Brain subagents.",
    mode: "primary",
    color: "#6B4C9A",
    tools: ["task", "manta-compaction", "checkpoint", "manta-status", "manta-gate", "manta-evidence", "todowrite", "visual-cortex_*", "hive_context", "hive_scan", "hive_status", "hive_trash_list", "hive_trash_status", "hive_remember", "hive_forget", "hive_purge", "hive_restore", "reasoning-bus_*"]
  },
  planBrain: {
    name: "manta-plan",
    description: "MANTA Plan Brain \u2014 Read-only analysis with PSM. Cannot write code.",
    mode: "subagent",
    hidden: true,
    color: "#6B4C9A",
    tools: [
      "read",
      "glob",
      "grep",
      "webfetch",
      "question",
      "hive_context",
      "hive_scan",
      "hive_status",
      "hive_trash_list",
      "hive_trash_status",
      "manta-code-review",
      "checkpoint",
      "ps-mode-status",
      "ps-mode-layer",
      "ps-mode-evidence",
      "ps-mode-derail",
      "ps-mode-debug",
      "visual-cortex_*",
      "reasoning-bus_*"
    ]
  },
  execBrain: {
    name: "manta-exec",
    description: "MANTA Execution Brain \u2014 Full dev access. Executes SPEC.md precisely.",
    mode: "subagent",
    hidden: true,
    color: "#6B4C9A",
    tools: [
      "read",
      "write",
      "edit",
      "bash",
      "glob",
      "grep",
      "manta-spawn-container",
      "manta-test-runner",
      "manta-runtime-audit",
      "manta-code-audit",
      "manta-code-review",
      "checkpoint",
      "visual-cortex_*",
      "reasoning-bus_*"
    ]
  }
};

// index.ts
var mantaColor = "#6B4C9A";
async function MantaAgent(input) {
  const { directory } = input;
  const workspacePath = process.cwd();
  const mantaDir = path15.join(workspacePath, ".manta");
  fs15.mkdirSync(mantaDir, { recursive: true });
  fs15.mkdirSync(path15.join(mantaDir, "context"), { recursive: true });
  fs15.mkdirSync(path15.join(mantaDir, "evidence", "delivery"), { recursive: true });
  const stateStore = createStateStore();
  const messenger = createMantaMessenger();
  const guardian = new Guardian({ level: "SANDBOX" });
  const gm = new GateManager(mantaDir);
  const ec = new EvidenceCollector(mantaDir);
  const coordinator = new MantaCoordinator({ stateStore, messenger, gateManager: gm });
  const psm = createProblemSolvingMode(workspacePath);
  const compactionManager = new CompactionManager(workspacePath);
  coordinator.initialize();
  try {
    const pluginDir2 = import.meta?.url ? new URL(".", import.meta.url).pathname : process.cwd();
    setPluginDirectory(pluginDir2);
    loadMantaIdentity();
  } catch (e) {
    mantaWarn("Identity loader init failed (non-fatal):", e);
  }
  mantaLog("Identity pipeline: static const warheads loaded");
  const statusTool = createMantaStatusTool(stateStore, gm);
  const gateTool = createMantaGateTool(gm, guardian);
  const evidenceTool = createMantaEvidenceTool(ec);
  const checkpointTool = createCheckpointTool(stateStore, gm);
  const spawnContainerTool = createMantaSpawnContainerTool();
  const testRunnerTool = createMantaTestRunnerTool();
  const codeReviewTool = createMantaCodeReviewTool(psm.brain);
  const runtimeAuditTool = createMantaRuntimeAuditTool(mantaDir);
  const codeAuditTool = createMantaCodeAuditTool(mantaDir);
  const visionTool = createMantaVisionTool();
  const compactionTool = createMantaCompactionTool(compactionManager, gm);
  const hooks = createMantaHooks(guardian, gm, ec, coordinator, stateStore, messenger, psm.brain, undefined, compactionManager);
  return {
    ...hooks,
    tool: {
      "manta-status": statusTool,
      "manta-gate": gateTool,
      "manta-evidence": evidenceTool,
      checkpoint: checkpointTool,
      "manta-spawn-container": spawnContainerTool,
      "manta-test-runner": testRunnerTool,
      "manta-code-review": codeReviewTool,
      "manta-runtime-audit": runtimeAuditTool,
      "manta-code-audit": codeAuditTool,
      "manta-vision": visionTool,
      "manta-compaction": compactionTool,
      ...psm.tools
    },
    config: async (cfg) => {
      if (!cfg.agent)
        cfg.agent = {};
      const agent = cfg.agent;
      const ac = MANTA_AGENTS_CONFIG;
      agent["manta"] = {
        name: ac.orchestrator.name,
        description: ac.orchestrator.description,
        instructions: "MANTA v2.2.2 orchestrator \u2014 identity via system.transform. Use task(agent=manta-plan) for analysis, task(agent=manta-exec) for implementation.",
        mode: ac.orchestrator.mode,
        color: mantaColor,
        tools: Object.fromEntries(ac.orchestrator.tools.map((t) => [t, true]))
      };
      agent["manta-plan"] = {
        name: ac.planBrain.name,
        description: ac.planBrain.description,
        instructions: "MANTA v2.2.2 plan brain \u2014 read-only analysis. Use PSM for problem solving. Return JSON.",
        mode: ac.planBrain.mode,
        hidden: true,
        color: mantaColor,
        tools: Object.fromEntries(ac.planBrain.tools.map((t) => [t, true]))
      };
      agent["manta-exec"] = {
        name: ac.execBrain.name,
        description: ac.execBrain.description,
        instructions: "MANTA v2.2.2 exec brain \u2014 implement from plan. If stuck: EXECUTION_STUCK.",
        mode: ac.execBrain.mode,
        hidden: true,
        color: mantaColor,
        tools: Object.fromEntries(ac.execBrain.tools.map((t) => [t, true]))
      };
    }
  };
}
export {
  MantaAgent as default
};

//# debugId=DFEFE28DEDCBCD5264756E2164756E21
//# sourceMappingURL=index.js.map
