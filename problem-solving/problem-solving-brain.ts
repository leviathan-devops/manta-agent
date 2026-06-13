import { ProblemSolvingStateMachine } from './state-machine.js';
import { AntiDerailmentEngine } from './anti-derailment.js';
import {
  ProblemSolvingLayer,
  GATE_CRITERIA,
  type DerailmentRecord,
  type IterationRecord,
  type ProblemSolvingState,
} from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BrainActivity {
  layer: number;
  action: string;
  output: string;
  timestamp: number;
}

export type BrainSignal = 'layer-passed' | 'layer-failed' | 'derailment-blocked' | 'iteration-advanced' | 'complete';

export class ProblemSolvingBrain {
  stateMachine: ProblemSolvingStateMachine;
  antiDerailment: AntiDerailmentEngine;

  private activityLog: BrainActivity[] = [];
  private debugLog: string[] = [];
  private basePath: string;

  constructor(basePath?: string) {
    this.stateMachine = new ProblemSolvingStateMachine();
    this.antiDerailment = new AntiDerailmentEngine();
    this.basePath = basePath ?? process.cwd();
  }

  initialize(problem: string): void {
    this.stateMachine.initialize(problem);
    this.activityLog = [];
    this.debugLog = [];

    this.appendDebug('INIT', `Problem Solving Mode initialized for: ${problem}`);

    const initDir = path.join(this.basePath, '.problem-solving');
    fs.mkdirSync(initDir, { recursive: true });
    fs.mkdirSync(path.join(initDir, 'iterations'), { recursive: true });
    fs.mkdirSync(path.join(initDir, 'evidence'), { recursive: true });
    fs.mkdirSync(path.join(initDir, 'debug-logs'), { recursive: true });

    this.saveIterationArtifact('00_INDEX.md', this.generateIndex());
  }

  detectDerailments(text: string): DerailmentRecord[] {
    const currentLayer = this.stateMachine.getCurrentLayer();
    const findings = this.antiDerailment.check(text, currentLayer);

    for (const f of findings) {
      this.stateMachine.recordDerailment(f.type, f.layer, f.evidence, f.blocked);
      this.appendDebug('DERAIL', `[${f.blocked ? 'BLOCKED' : 'WARN'}] ${f.type}: ${f.evidence}`);
    }

    return findings;
  }

  passLayer(content: Record<string, unknown>): void {
    const layer = this.stateMachine.getCurrentLayer();
    const validation = this.validateLayerContent(layer, content);

    if (!validation.valid) {
      this.failLayer(validation.errors?.join('; ') ?? 'validation failed');
      return;
    }

    this.stateMachine.passLayer({
      complete: true,
      content,
      passed: true,
      errors: [],
    });

    const layerName = this.getLayerName(layer);
    this.saveIterationArtifact(this.getLayerFilename(layer), this.formatLayerOutput(layer, content));

    this.appendDebug('PASS', `${layerName} passed`);
    this.logActivity(layer, 'pass', `${layerName} completed`);

    this.saveIterationArtifact('00_INDEX.md', this.generateIndex());
  }

  failLayer(error: string): void {
    const result = this.stateMachine.failLayer(error);
    const layer = this.stateMachine.getCurrentLayer();
    const layerName = this.getLayerName(layer);

    this.appendDebug('FAIL', `${layerName} failed: ${error} => ${result.action}`);

    switch (result.action) {
      case 'retry':
        this.logActivity(layer, 'retry', `Attempt ${this.stateMachine.getLayerAttempts()}/${this.stateMachine.state.maxLayerAttempts}`);
        break;
      case 'new-iteration':
        this.logActivity(layer, 'new-iteration', `Advanced to ${this.stateMachine.getCurrentIteration()}`);
        this.appendDebug('ITERATION', `New iteration: ${this.stateMachine.getCurrentIteration()}`);
        this.saveIterationArtifact('00_INDEX.md', this.generateIndex());
        break;
      case 'escalate':
        this.logActivity(layer, 'escalate', 'Max iterations reached — escalation required');
        this.appendDebug('ESCALATE', 'Problem could not be solved within max iterations');
        break;
    }
  }

  validateLayerContent(layer: ProblemSolvingLayer, content: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    const criteria = this.getLayerCriteria(layer);

    for (const [key, required] of Object.entries(criteria)) {
      if (required && !content[key]) {
        errors.push(`Missing required field: ${key}`);
      }
    }

    if (layer === ProblemSolvingLayer.LAYER_1) {
      const assumption = typeof content['Explicit Assumption'] === 'string' ? content['Explicit Assumption'] : '';
      if (!assumption || assumption.length < 10) {
        errors.push('Assumption must be a clear, specific statement (min 10 chars)');
      }
    }

    if (layer === ProblemSolvingLayer.LAYER_2) {
      const command = typeof content['Exact Command'] === 'string' ? content['Exact Command'] : '';
      if (!command) {
        errors.push('Exact command is required');
      }
    }

    if (layer === ProblemSolvingLayer.LAYER_3) {
      const raw = typeof content['Raw Evidence'] === 'string' ? content['Raw Evidence'] : '';
      if (raw) {
        const validation = this.antiDerailment.validateEvidence(raw, (content as Record<string, unknown>)['evidenceSource'] === 'external');
        if (!validation.valid) {
          errors.push(validation.reason ?? 'Invalid evidence');
        }
      } else {
        errors.push('Raw evidence is required');
      }
    }

    if (layer === ProblemSolvingLayer.LAYER_4) {
      const gap = typeof content['Gap Analysis'] === 'string' ? content['Gap Analysis'] : '';
      if (gap && !gap.includes('expected') && !gap.includes('Expected')) {
        errors.push('Gap analysis must use "Expected X, got Y, therefore Z" format');
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  getLayerCriteria(layer: ProblemSolvingLayer): Record<string, boolean> {
    return GATE_CRITERIA[layer]?.requirements ?? {};
  }

  getBrainT1(): string {
    return this.stateMachine.getT1Prompt();
  }

  getSystemPrompt(): string {
    const state = this.stateMachine.getState();
    const t1 = this.stateMachine.getT1Prompt();
    if (state.currentLayer === 7) return t1;

    return `${t1}

CRITICAL: This is your SYSTEM PROMPT, not a suggestion. You are operating in Problem Solving Mode.
Every response MUST include a call to ps-mode-layer or ps-mode-status. Do NOT respond without PSM tool calls.
You are currently on Layer ${state.currentLayer} of 6. Complete the current layer before any other action.`;
  }

  isActive(): boolean {
    return this.stateMachine.getState().currentLayer > 0 && this.stateMachine.getState().currentLayer < 7;
  }

  processSignal(signal: BrainSignal, payload?: unknown): string {
    switch (signal) {
      case 'layer-passed':
        return 'Layer passed. Advancing to next layer.';
      case 'layer-failed':
        return 'Layer failed. Review derailment records and retry.';
      case 'derailment-blocked':
        return `Derailment blocked: ${payload}`;
      case 'iteration-advanced':
        return `Advanced to ${this.stateMachine.getCurrentIteration()}`;
      case 'complete':
        return 'Problem solving complete.';
    }
  }

  getDebugLog(): string[] {
    return [...this.debugLog];
  }

  appendDebug(category: string, message: string): void {
    const timestamp = new Date().toISOString();
    this.debugLog.push(`[${timestamp}] [${category}] ${message}`);
  }

  saveDebugLog(): void {
    const logDir = path.join(this.basePath, '.problem-solving', 'debug-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `debug-${this.stateMachine.getCurrentIteration()}.log`);
    fs.writeFileSync(logPath, this.debugLog.join('\n'), 'utf-8');
  }

  private saveIterationArtifact(filename: string, content: string): void {
    const iterDir = path.join(this.basePath, '.problem-solving', 'iterations', this.stateMachine.getCurrentIteration());
    fs.mkdirSync(iterDir, { recursive: true });
    fs.writeFileSync(path.join(iterDir, filename), content, 'utf-8');
  }

  private getLayerName(layer: ProblemSolvingLayer): string {
    const names: Record<number, string> = {
      1: 'Assumption Statement',
      2: 'Action with Prediction',
      3: 'Observation & Evidence',
      4: 'Gap Analysis & Adjustment',
      5: 'Meta-Cognitive Reflection',
      6: 'Verification & Confirmation',
    };
    return names[layer] ?? `Layer ${layer}`;
  }

  private getLayerFilename(layer: ProblemSolvingLayer): string {
    const files: Record<number, string> = {
      1: '01_ASSUMPTION.md',
      2: '02_ACTION.md',
      3: '03_OBSERVATION.md',
      4: '04_GAP_ANALYSIS.md',
      5: '05_META_REFLECTION.md',
      6: '06_VERIFICATION.md',
    };
    return files[layer] ?? `layer-${layer}.md`;
  }

  private formatLayerOutput(layer: ProblemSolvingLayer, content: Record<string, unknown>): string {
    const lines: string[] = [];
    lines.push(`# ${this.getLayerName(layer)}`);
    lines.push(`**Iteration:** ${this.stateMachine.getCurrentIteration()}`);
    lines.push(`**Completed at:** ${new Date().toISOString()}`);
    lines.push('');
    for (const [key, value] of Object.entries(content)) {
      lines.push(`## ${key}`);
      lines.push('');
      lines.push(String(value));
      lines.push('');
    }
    return lines.join('\n');
  }

  private generateIndex(): string {
    const state = this.stateMachine.getState();
    const lines: string[] = [];
    lines.push('# Problem Solving Mode — Iteration Index');
    lines.push('');
    lines.push(`Iteration: ${state.iteration}`);
    lines.push(`Current Layer: Layer ${state.currentLayer}`);
    lines.push(`Status: ${state.currentLayer === 7 ? 'COMPLETE' : 'IN PROGRESS'}`);
    lines.push('');
    lines.push('## Layers');
    for (let i = 1; i <= 6; i++) {
      const name = this.getLayerName(i as ProblemSolvingLayer);
      const isCurrent = state.currentLayer === i;
      const passed = i < state.currentLayer;
      const icon = passed ? '✓' : isCurrent ? '→' : '○';
      lines.push(`${icon} Layer ${i}: ${name}`);
    }
    return lines.join('\n');
  }

  logActivity(layer: number, action: string, output: string): void {
    this.activityLog.push({ layer, action, output, timestamp: Date.now() });
  }

  getActivityLog(): BrainActivity[] {
    return [...this.activityLog];
  }

  getState(): ProblemSolvingState {
    return this.stateMachine.getState();
  }

  getCurrentRecord(): IterationRecord | undefined {
    return this.stateMachine.getCurrentRecord();
  }

  getIterationCount(): number {
    return this.stateMachine.getIterationCount();
  }
}
