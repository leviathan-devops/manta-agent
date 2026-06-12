/**
 * V4 State Store — Copied from Agent Factory Edition
 *
 * Shared state store with domain ownership enforcement.
 * Each brain can only WRITE to its owned state domains.
 * All brains can READ from all domains.
 */

export type StateDomain = 
  | 'plan-state' 
  | 'manta-state' 
  | 'manta-context' 
  | 'manta-reasoning'
  | 'manta-workflow'
  | 'manta-quality'
  | 'manta-security';

export interface WriteResult {
  success: boolean;
  version: number;
  error?: string;
}

export interface Unsubscribe {
  (): void;
}

export interface StateSnapshot {
  data: Record<string, unknown>;
  versions: Record<string, number>;
  timestamp: number;
}

export interface StateStore {
  get<T>(key: string, domain?: StateDomain): T | undefined;
  set<T>(key: string, value: T, domain: StateDomain, ownerBrain?: string): WriteResult;
  watch(key: string, callback: (value: unknown, version: number) => void): Unsubscribe;
  snapshot(): StateSnapshot;
  restore(snapshot: StateSnapshot): void;
  cleanup(): void;
}

// Manta v2.2 domain ownership
export const DOMAIN_OWNERSHIP: Record<StateDomain, string[]> = {
  'plan-state': ['manta-plan-brain'],
  'manta-state': ['manta-coordinator'],
  'manta-context': ['manta-plan-brain'],
  'manta-reasoning': ['manta-reasoning-brain'],
  'manta-workflow': ['manta-coordinator'],
  'manta-quality': ['manta-plan-brain'],
  'manta-security': ['manta-coordinator'],
};

import { mantaError } from './manta-logger.js';

export function createStateStore(): StateStore {
  const data = new Map<string, unknown>();
  const versions = new Map<string, number>();
  const watchers = new Map<string, Array<(value: unknown, version: number) => void>>();

  function getKey(key: string, domain?: StateDomain): string {
    return domain ? `${domain}:${key}` : key;
  }

  return {
    get<T>(key: string, domain?: StateDomain): T | undefined {
      const fullKey = getKey(key, domain);
      return data.get(fullKey) as T | undefined;
    },

    set<T>(key: string, value: T, domain: StateDomain, ownerBrain?: string): WriteResult {
      const fullKey = getKey(key, domain);

      if (ownerBrain) {
        const owners = DOMAIN_OWNERSHIP[domain];
        if (owners && !owners.includes(ownerBrain)) {
          return {
            success: false,
            version: versions.get(fullKey) ?? 0,
            error: `Brain "${ownerBrain}" does not own domain "${domain}". Owners: ${owners.join(', ')}`,
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
            mantaError('state-store: watcher callback error:', e);
          }
        }
      }

      return { success: true, version: newVersion };
    },

    watch(key: string, callback: (value: unknown, version: number) => void): Unsubscribe {
      const allKeys = [key];
      for (const domain of Object.keys(DOMAIN_OWNERSHIP)) {
        allKeys.push(`${domain}:${key}`);
      }

      for (const fullKey of allKeys) {
        if (!watchers.has(fullKey)) {
          watchers.set(fullKey, []);
        }
        watchers.get(fullKey)!.push(callback);
      }

      return () => {
        for (const fullKey of allKeys) {
          const list = watchers.get(fullKey);
          if (list) {
            const idx = list.indexOf(callback);
            if (idx !== -1) list.splice(idx, 1);
          }
        }
      };
    },

    snapshot(): StateSnapshot {
      const snapshotData: Record<string, unknown> = {};
      const snapshotVersions: Record<string, number> = {};

      for (const [key, value] of data.entries()) {
        snapshotData[key] = value;
      }
      for (const [key, version] of versions.entries()) {
        snapshotVersions[key] = version;
      }

      return {
        data: snapshotData,
        versions: snapshotVersions,
        timestamp: Date.now(),
      };
    },

    restore(snapshot: StateSnapshot): void {
      data.clear();
      versions.clear();

      for (const [key, value] of Object.entries(snapshot.data)) {
        data.set(key, value);
      }
      for (const [key, version] of Object.entries(snapshot.versions)) {
        versions.set(key, version);
      }
    },

    cleanup(): void {
      data.clear();
      versions.clear();
      watchers.clear();
    },
  };
}
