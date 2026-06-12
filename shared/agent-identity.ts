/**
 * Agent identity detection — case-insensitive matching
 */
const MANTA_NAMES = new Set(['manta', 'manta-plan', 'manta-exec']);

export function isMantaAgent(agent: string | undefined): boolean {
  if (!agent) return false;
  const lower = agent.toLowerCase();
  return MANTA_NAMES.has(lower) || lower.startsWith('manta-') || lower.startsWith('manta_');
}

export function isMantaPlan(agent: string | undefined): boolean {
  if (!agent) return false;
  return agent.toLowerCase() === 'manta-plan';
}

export function isMantaExec(agent: string | undefined): boolean {
  if (!agent) return false;
  return agent.toLowerCase() === 'manta-exec';
}

export function isMantaOrchestrator(agent: string | undefined): boolean {
  if (!agent) return false;
  return agent.toLowerCase() === 'manta';
}

export function isVanillaAgent(agent: string | undefined): boolean {
  if (!agent) return false;
  return ['plan', 'build', 'general', 'explore'].includes(agent.toLowerCase());
}
