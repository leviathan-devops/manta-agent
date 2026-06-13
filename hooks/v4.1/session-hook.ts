import type { Hooks } from '@opencode-ai/plugin';
import { GateManager } from '../../shared/gates.js';
import { EvidenceCollector } from '../../shared/evidence.js';
import type { MantaCoordinator } from '../../manta/coordinator.js';
import { isMantaAgent } from '../../shared/agent-identity.js';
import { setCurrentAgent, clearCurrentAgent } from './agent-state.js';
import type { StateStore } from '../../shared/state-store.js';
import type { MantaMessenger } from '../../shared/messenger.js';
import type { CompactionManager } from '../../shared/compaction-manager.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

let dirCreationAttempted = false;

export function createSessionHook(
  gateManager: GateManager,
  _evidenceCollector: EvidenceCollector,
  coordinator: MantaCoordinator | undefined,
  stateStore: StateStore,
  messenger: MantaMessenger,
  compactionManager?: CompactionManager
): Hooks['event'] {
  return async (input: { event?: { type?: string; sessionId?: string; agent?: string } }) => {
    const event = input.event as { type?: string; sessionId?: string; agent?: string };
    if (!event?.type) return;

    if (!isMantaAgent(event.agent)) {
      setCurrentAgent(undefined, event.sessionId);
      return;
    }

    setCurrentAgent(event.agent, event.sessionId);

    switch (event.type) {
      case 'session.created':
        handleSessionCreated(gateManager, coordinator, compactionManager, event.sessionId);
        break;
      case 'session.ended':
        handleSessionEnded(stateStore, messenger, event.sessionId);
        break;
    }
  };
}

function handleSessionCreated(
  gateManager: GateManager,
  coordinator?: MantaCoordinator,
  compactionManager?: CompactionManager,
  sessionId?: string
): void {
  const gateState = {
    currentGate: 'plan',
    gateStatus: { plan: 'pending', build: 'pending', review: 'pending', verify: 'pending', test: 'pending', audit: 'pending', delivery: 'pending' },
    verifyAttempts: 0,
    currentIteration: 'V1.0',
    iterationAttempts: {},
  };
  gateManager.restore(gateState);
  if (coordinator) coordinator.initialize();
  if (!dirCreationAttempted) {
    dirCreationAttempted = true;
    const mantaDir = path.join(process.cwd(), '.manta');
    fs.mkdirSync(mantaDir, { recursive: true });
    fs.mkdirSync(path.join(mantaDir, 'context'), { recursive: true });
    fs.mkdirSync(path.join(mantaDir, 'evidence'), { recursive: true });
    fs.mkdirSync(path.join(mantaDir, 'checkpoints'), { recursive: true });
  }
  if (compactionManager) compactionManager.initialize(gateState);
}

function handleSessionEnded(stateStore: StateStore, messenger: MantaMessenger, sessionId?: string): void {
  stateStore.cleanup();
  messenger.cleanup();
  dirCreationAttempted = false;
  setCurrentAgent(undefined, sessionId);
  clearCurrentAgent(sessionId);
}
