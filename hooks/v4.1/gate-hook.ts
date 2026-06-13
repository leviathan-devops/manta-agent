/**
 * Gate + Evidence Hook — tool.execute.after integration
 * 
 * Collects evidence after tool execution and advances gates when criteria met.
 * Wires coordinator for brain switching on build complete.
 * 
 * V2.0: 7-GATE CHAIN — PLAN→BUILD→REVIEW→VERIFY→TEST→AUDIT→DELIVERY
 * - BUILD→REVIEW: When implementation file with actual code is written
 * - REVIEW→VERIFY: When code review report passes (spec alignment check)
 * - VERIFY→TEST: When spec alignment confirmed + code review passed
 * - TEST→AUDIT: When container tests pass (96%+) + runtime audit
 * - AUDIT→DELIVERY: Auto-advance when scans clean, create checkpoint
 */

import type { Hooks } from '@opencode-ai/plugin';
import { GateManager } from '../../shared/gates.js';
import { EvidenceCollector, type GateEvidence, type GateName } from '../../shared/evidence.js';
import { extractCommandFromArgs, extractPathFromToolArgs } from './utils.js';
import type { MantaCoordinator } from '../../manta/coordinator.js';
import { isMantaAgent } from '../../shared/agent-identity.js';
import { mantaError } from '../../shared/manta-logger.js';

export function createGateHook(
  gateManager: GateManager,
  evidenceCollector: EvidenceCollector,
  coordinator?: MantaCoordinator
): Hooks['tool.execute.after'] {
  return async (input: any, output: any) => {
    const { tool, sessionID } = input;
    const agent = input?.agent || '';
    
    if (!isMantaAgent(agent)) {
      return;
    }
    
    const args = (input as { args: unknown }).args;
    const result = (output as { output: unknown }).output;
    const currentGate = gateManager.getCurrentGate();

    const evidence = buildEvidenceRecord(tool, args, result);
    if (evidence) {
      const gateEvidence: GateEvidence = {
        gate: currentGate,
        timestamp: Date.now(),
        passed: true,
        files: evidence.files || [],
        metadata: {
          tool,
          sessionID,
          workEvidence: evidence.workEvidence,
        },
      };
      evidenceCollector.collectEvidence(gateEvidence);
    }

    const shouldAdvance = checkGateAdvance(tool, args, result, currentGate, evidence);

    if (shouldAdvance && gateManager.canTransition(shouldAdvance)) {
      gateManager.passCurrentGate();
      gateManager.transitionTo(shouldAdvance);
      mantaError('Gate advanced:', currentGate, '→', shouldAdvance);

      try {
        if (shouldAdvance === 'build' && currentGate === 'plan' && coordinator) {
          coordinator.onSpecComplete();
        }

        if (shouldAdvance === 'review' && currentGate === 'build' && coordinator) {
          coordinator.onBuildComplete();
        }

        if (shouldAdvance === 'verify' && currentGate === 'review' && coordinator) {
          coordinator.switchToPlan('review-complete');
        }
      } catch (error) {
        mantaError('Coordinator notification error:', error);
      }
    }

    if (currentGate === 'verify') {
      const verifyResultStr = result ? JSON.stringify(result) : '';
      const verifyHasError = verifyResultStr.includes('"error"') || 
                             verifyResultStr.includes('"status":"error"') ||
                             verifyResultStr.includes('"status":"fail"') ||
                             (verifyResultStr.includes('"exitCode":') && verifyResultStr.includes('1'));
      
      const hasFailureIndicator = /command failed|test failed|build failed|error:/i.test(verifyResultStr);

      if (verifyHasError || hasFailureIndicator) {
        const verifyLoopResult = gateManager.handleVerifyFailure();
        const state = gateManager.getState() as { verifyAttempts: number };
        mantaError('VERIFY failure detected (attempt', state.verifyAttempts, '/3)');

        if (coordinator && state.verifyAttempts >= 3) {
          coordinator.onGateFailed('verify', state.verifyAttempts);
        }

        if (verifyLoopResult.action === 'escalate') {
          const escalatedIteration = verifyLoopResult.iteration;
          mantaError('ITERATION ESCALATION:', escalatedIteration, '— returning to PLAN');
          mantaError('STATE iteration=', escalatedIteration, 'gate=plan');
        }
      }
    }
  };
}

function buildEvidenceRecord(tool: string, args: unknown, result: unknown): { files: string[]; workEvidence: string } | null {
  if (!args) return null;
  const a = args as Record<string, unknown>;

  switch (tool) {
    case 'write_file':
    case 'mcp_write_file':
    case 'write':
    case 'mcp_write': {
      const filePath = (a.path as string) || (a.filePath as string) || (a.file_path as string) || (a.target as string);
      const content = (a.content as string) || (a.text as string) || (a.body as string);
      const pathInContent = typeof content === 'string' && content.length > 0 ? ` (${content.slice(0, 30)}...)` : '';
      return { files: filePath ? [filePath] : [], workEvidence: `wrote:${filePath || 'unknown'}${pathInContent}` };
    }
    case 'patch':
    case 'mcp_patch': {
      const filePath = (a.path as string) || (a.filePath as string);
      return { files: filePath ? [filePath] : [], workEvidence: `patched:${filePath}` };
    }
    case 'terminal':
    case 'mcp_terminal':
    case 'bash':
    case 'shell': {
      const cmd = extractCommandFromArgs(args) || '';
      return { files: [], workEvidence: `ran:${cmd.slice(0, 100)}` };
    }
    case 'read':
    case 'mcp_read': {
      const filePath = extractPathFromToolArgs(args);
      return { files: filePath ? [filePath] : [], workEvidence: `read:${filePath}` };
    }
    case 'manta-code-review': {
      return { files: ['CodeReviewReport.json'], workEvidence: 'reviewed:code' };
    }
    default:
      return null;
  }
}

function checkGateAdvance(
  tool: string,
  args: unknown,
  result: unknown,
  currentGate: GateName,
  evidence: { files: string[]; workEvidence: string } | null
): GateName | null {
  const resultStr = result ? JSON.stringify(result) : '';
  const hasError = resultStr.includes('"error"') || resultStr.includes('"status":"error"');
  const cmd = extractCommandFromArgs(args) || '';

  if (currentGate === 'plan') {
    if (hasError) return null;

    const hasPlanDoc = evidence?.files.some(f =>
      /SPEC\.md|spec\.md|plan\.md|design\.md/i.test(f)
    ) || evidence?.workEvidence.includes('SPEC');

    if (hasPlanDoc) {
      return 'build';
    }

    const hasImplFile = evidence?.files.some(f =>
      /\.(html|ts|js|py|css|jsx|tsx|go|rs|java|cpp|c)$/i.test(f)
    );

    if (hasImplFile) {
      mantaError('BLOCKED: Implementation file written before SPEC.md');
      return null;
    }
  }

  if (currentGate === 'build') {
    if (hasError) return null;

    if (['write_file', 'mcp_write_file', 'write', 'mcp_write', 'patch', 'mcp_patch'].includes(tool)) {
      const isImplFile = evidence?.files.some(f =>
        /\.(html|ts|js|py|css|jsx|tsx|go|rs|java|cpp|c)$/i.test(f)
      );
      const hasCodeContent = evidence?.workEvidence.includes('(<!DOCTYPE') ||
                             evidence?.workEvidence.includes('<script') ||
                             evidence?.workEvidence.includes('function ') ||
                             evidence?.workEvidence.includes('function(') ||
                             evidence?.workEvidence.includes('class ') ||
                             evidence?.workEvidence.includes('const ') ||
                             evidence?.workEvidence.includes('import ') ||
                             evidence?.workEvidence.includes('def ') ||
                             evidence?.workEvidence.includes('func ');

      if (isImplFile && hasCodeContent) {
        return 'review';
      }
      return null;
    }
  }

  if (currentGate === 'review') {
    if (hasError) return null;

    const hasReviewReport = evidence?.files.some(f =>
      /CodeReviewReport\.json/i.test(f)
    );
    const reviewPassed = resultStr.includes('overallScore') && !resultStr.includes('"status":"failed"');
    const reviewToolCalled = tool === 'manta-code-review' && (
      resultStr.includes('passed') || 
      resultStr.includes('overallPassed') || 
      resultStr.includes('overallScore')
    );

    if (hasReviewReport || reviewPassed || reviewToolCalled) {
      return 'verify';
    }

    if (tool === 'manta-code-review') {
      mantaError('Code review tool returned');
    }
    return null;
  }

  if (currentGate === 'verify') {
    if (hasError) return null;

    const specRead = evidence?.files.some(f => /SPEC\.md|spec\.md/i.test(f));
    const codeReviewTool = tool === 'manta-code-review';
    const reviewPass = resultStr.includes('passed') || resultStr.includes('overallPassed');

    if (specRead || (codeReviewTool && reviewPass)) {
      mantaError('Spec alignment confirmed, advancing to TEST gate');
      return 'test';
    }

    return null;
  }

  if (currentGate === 'test') {
    if (hasError) return null;

    const containerTestResult = resultStr.includes('ContainerTestResult') || 
                                resultStr.includes('passRate') ||
                                resultStr.includes('overallPassed');
    const testRunnerTool = tool === 'manta-test-runner';
    const testPass = containerTestResult || testRunnerTool;

    if (testPass) {
      mantaError('Container tests passed, advancing to AUDIT gate');
      return 'audit';
    }

    return null;
  }

  if (currentGate === 'audit') {
    if (hasError) return null;

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
    const hasSASTOutput = sastPatterns.some((p: RegExp) => p.test(resultStr));

    const runtimeAuditPass = tool === 'manta-runtime-audit' && 
                             (resultStr.includes('"passed":true') || resultStr.includes('"passed": true'));
    const codeAuditPass = tool === 'manta-code-audit' && 
                           (resultStr.includes('"critical":0') || resultStr.includes('"critical": 0'));

    if (hasSASTOutput || runtimeAuditPass || codeAuditPass) {
      mantaError('AUDIT complete, advancing to DELIVERY');
      return 'delivery';
    }
    
    return null;
  }

  return null;
}
