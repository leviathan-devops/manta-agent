import {
  ANTI_DERAILMENT_CHECKS,
  DERAILMENT_SEVERITY,
  ProblemSolvingLayer,
  type DerailmentRecord,
  type DerailmentType,
} from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mantaError } from '../shared/manta-logger.js';

function getContainerEvidencePaths(): string[] {
  return [
    '.manta/evidence/delivery/ContainerTestResult.json',
    path.join(process.cwd(), '.manta', 'evidence', 'delivery', 'ContainerTestResult.json'),
  ];
}

export class AntiDerailmentEngine {
  private patterns: Map<DerailmentType, RegExp[]> = new Map();

  constructor() {
    this.patterns.set('host-fallback', [
      /host\s+testing.*already proves/i,
      /on the host.*works/i,
      /local.*already.*tested/i,
      /skip.*container/i,
      /test on host/i,
      /not.*need.*container/i,
    ]);
    this.patterns.set('success-claim-without-proof', [
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
      /no further test needed/i,
    ]);
    this.patterns.set('mock-stub-suggestion', [
      /use a mock/i,
      /stub approach/i,
      /fake it/i,
      /just mock/i,
      /simulate/i,
    ]);
    this.patterns.set('blind-retry', [
      /try again/i,
      /retry the same/i,
      /just retry/i,
      /same thing/i,
    ]);
    this.patterns.set('self-referencing-proof', [
      /i created.*json.*therefore/i,
      /the file shows/i,
      /as written in.*json/i,
    ]);
    this.patterns.set('vague-assumption', [
      /i think.*might/i,
      /maybe it.*could/i,
      /perhaps.*might/i,
      /not sure but/i,
    ]);
    this.patterns.set('vague-action', [
      /test it/i,
      /check if.*works/i,
      /see what happens/i,
      /try something/i,
    ]);
    this.patterns.set('no-raw-evidence', [
      /the output was/i,
      /it returned/i,
      /based on.*result/i,
    ]);
    this.patterns.set('no-gap-analysis', [
      /didn't work/i,
      /failed.*again/i,
      /still broken/i,
    ]);
    this.patterns.set('no-pattern-extraction', [
      /next time.*try/i,
      /will remember/i,
    ]);
    this.patterns.set('syntax-only-verification', [
      /syntax.*valid/i,
      /compiles.*fine/i,
      /type.*check.*pass/i,
      /builds successfully/i,
    ]);
  }

  check(text: string, currentLayer: ProblemSolvingLayer): DerailmentRecord[] {
    const findings: DerailmentRecord[] = [];

    for (const [type, regexps] of this.patterns.entries()) {
      const check = ANTI_DERAILMENT_CHECKS.find((c: { check: string; description: string; enforcedAt: number }) => {
        const typeStr = type.replace(/_/g, '-');
        const checkDesc = c.check.toLowerCase().replace(/\s+/g, '-');
        return checkDesc.includes(typeStr) || typeStr.includes(checkDesc);
      });

      if (check && currentLayer < check.enforcedAt) continue;

      for (const pattern of regexps) {
        if (pattern.test(text)) {
          const severity = DERAILMENT_SEVERITY[type];
          findings.push({
            type,
            layer: currentLayer,
            evidence: `Pattern matched: ${pattern.source}`,
            blocked: severity === 'BLOCKER',
            timestamp: Date.now(),
          });
          break;
        }
      }
    }

    if (currentLayer === ProblemSolvingLayer.LAYER_6) {
      const containerCheck = this.checkContainerEvidence();
      if (!containerCheck.valid) {
        findings.push({
          type: 'success-claim-without-proof',
          layer: currentLayer,
          evidence: containerCheck.reason!,
          blocked: true,
          timestamp: Date.now(),
        });
      } else {
        const successFindings = findings.filter((f: DerailmentRecord) => f.type === 'success-claim-without-proof');
        for (const f of successFindings) {
          const idx = findings.indexOf(f);
          if (idx !== -1) findings.splice(idx, 1);
        }
      }
    }

    return findings;
  }

  checkContainerEvidence(): { valid: boolean; reason?: string; passRate?: number } {
    for (const evidencePath of getContainerEvidencePaths()) {
      const fullPath = path.resolve(process.cwd(), evidencePath);
      if (fs.existsSync(fullPath)) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
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
        } catch (e) {
          mantaError('anti-derailment: container evidence parse failed:', e);
          return { valid: false, reason: 'Container test evidence file is corrupted' };
        }
      }
    }

    return { valid: false, reason: 'NO ContainerTestResult.json found. Run manta-test-runner action=run to produce container test evidence. Host testing is NOT valid evidence.' };
  }

  validateEvidence(raw: string, isExternal: boolean): { valid: boolean; reason?: string } {
    if (!raw || raw.trim().length === 0) {
      return { valid: false, reason: 'No evidence provided' };
    }

    if (!isExternal) {
      return { valid: false, reason: 'Self-referencing proof: evidence must come from external system' };
    }

    if (raw.includes('[paste') || raw.includes('[your') || raw.includes('[actual')) {
      return { valid: false, reason: 'Contains unfilled template placeholder' };
    }

    return { valid: true };
  }

  _validateExpectedOutput(actual: string, expected: string): { match: boolean; gaps: string[] } {
    const gaps: string[] = [];
    const normalizedActual = actual.toLowerCase().trim();
    const normalizedExpected = expected.toLowerCase().trim();

    if (!normalizedActual || !normalizedExpected) {
      return { match: false, gaps: ['Missing actual or expected output'] };
    }

    if (normalizedActual.includes('error') && !normalizedExpected.includes('error')) {
      gaps.push('Expected success but got error');
    }

    if (normalizedActual.includes('fail') && !normalizedExpected.includes('fail')) {
      gaps.push('Expected success but got failure');
    }

    return { match: gaps.length === 0, gaps };
  }

  _getChecksForLayer(layer: ProblemSolvingLayer): string[] {
    return ANTI_DERAILMENT_CHECKS
      .filter((c: { check: string; description: string; enforcedAt: number }) => c.enforcedAt <= layer)
      .map((c: { check: string; description: string; enforcedAt: number }) => `[${c.enforcedAt <= layer ? 'ENFORCED' : 'PENDING'}] ${c.check}: ${c.description}`);
  }

  toContextString(): string {
    const lines: string[] = ['[ANTI-DERAILMENT ENGINE]'];
    for (const check of ANTI_DERAILMENT_CHECKS) {
      lines.push(`  ${check.check}: ${check.description}`);
    }
    lines.push('');
    lines.push('[CONTAINER EVIDENCE REQUIREMENT]');
    lines.push('  Layer 6 (Verification) requires ContainerTestResult.json with 96%+ pass rate.');
    lines.push('  Run: manta-test-runner action=run');
    lines.push('  Host testing is NOT valid evidence.');
    return lines.join('\n');
  }
}
