import type { StateStore } from '../shared/state-store.js';
import type { MantaMessenger } from '../shared/messenger.js';
import type { GateManager } from '../shared/gates.js';

type BrainType = 'plan' | 'build';

interface MantaCoordinatorState {
  currentBrain: BrainType;
  switchReason: string;
  lastSwitchAt: number;
}

interface CoordinatorConfig {
  stateStore: StateStore;
  messenger: MantaMessenger;
  gateManager: GateManager;
}

export class MantaCoordinator {
  private stateStore: StateStore;
  private messenger: MantaMessenger;
  private gateManager: GateManager;

  constructor(config: CoordinatorConfig) {
    this.stateStore = config.stateStore;
    this.messenger = config.messenger;
    this.gateManager = config.gateManager;
  }

  initialize(): void {
    const state: MantaCoordinatorState = {
      currentBrain: 'plan',
      switchReason: 'session-start',
      lastSwitchAt: Date.now(),
    };
    this.stateStore.set('manta-micro-state', state, 'manta-state');
  }

  getCurrentBrain(): BrainType {
    const microState = this.stateStore.get<MantaCoordinatorState>('manta-micro-state', 'manta-state');
    return microState?.currentBrain || 'plan';
  }

  canSwitch(from: BrainType, to: BrainType): boolean {
    if (from === to) return false;
    if (from === 'plan' && to === 'build') return true;
    if (from === 'build' && to === 'plan') return true;
    return false;
  }

  switchToPlan(reason: string): void {
    const state: MantaCoordinatorState = {
      currentBrain: 'plan',
      switchReason: reason,
      lastSwitchAt: Date.now(),
    };
    this.stateStore.set('manta-micro-state', state, 'manta-state');
  }

  switchToBuild(reason: string): void {
    const state: MantaCoordinatorState = {
      currentBrain: 'build',
      switchReason: reason,
      lastSwitchAt: Date.now(),
    };
    this.stateStore.set('manta-micro-state', state, 'manta-state');
  }

  onBuildComplete(): void {
    const current = this.getCurrentBrain();
    if (current === 'build' && this.canSwitch(current, 'plan')) {
      this.switchToPlan('build-complete');
      this.messenger.send({
        from: 'coordinator',
        to: 'manta-plan',
        type: 'handoff',
        priority: 'high',
        payload: { signal: 'build-complete', timestamp: Date.now() },
        requiresAck: false,
      });
    }
  }

  onSpecComplete(): void {
    const current = this.getCurrentBrain();
    if (current === 'plan' && this.canSwitch(current, 'build')) {
      this.switchToBuild('spec-complete');
      this.messenger.send({
        from: 'coordinator',
        to: 'manta-exec',
        type: 'handoff',
        priority: 'critical',
        payload: { signal: 'spec-complete', timestamp: Date.now() },
        requiresAck: false,
      });
    }
  }

  onGateFailed(gateName: string, attempts: number): void {
    if (attempts >= 3) {
      this.switchToPlan('escalation-3-failures');
      this.messenger.send({
        from: 'coordinator',
        to: 'manta-plan',
        type: 'alert',
        priority: 'critical',
        payload: { gate: gateName, attempts, signal: 'escalation', timestamp: Date.now() },
        requiresAck: false,
      });
    }
  }
}
