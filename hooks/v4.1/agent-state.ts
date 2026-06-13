interface AgentState {
  agent: string | undefined;
  timestamp: number;
  lastUserMessage: string;
}

const agentBySession = new Map<string, AgentState>();

export function setCurrentAgent(agent: string | undefined, sessionId?: string, userMessage?: string): void {
  const sid = sessionId || 'default';
  const current = agentBySession.get(sid);
  agentBySession.set(sid, {
    agent,
    timestamp: Date.now(),
    lastUserMessage: userMessage || current?.lastUserMessage || '',
  });
}

export function getCurrentAgent(sessionId?: string): string | undefined {
  const sid = sessionId || 'default';
  return agentBySession.get(sid)?.agent;
}

export function getLastUserMessage(sessionId?: string): string | undefined {
  const sid = sessionId || 'default';
  return agentBySession.get(sid)?.lastUserMessage;
}

export function clearCurrentAgent(sessionId?: string): void {
  agentBySession.delete(sessionId || 'default');
}
