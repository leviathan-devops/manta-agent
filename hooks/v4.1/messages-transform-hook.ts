import type { Hooks } from '@opencode-ai/plugin';

/**
 * messages.transform hook — Output-side identity enforcement
 * 
 * Scans assistant responses for identity drift and replaces them.
 * This catches the runtime default ("You are opencode") winning
 * over MANTA's injected identity header.
 * 
 * Uses system prompt content detection (session-agnostic) instead
 * of session-scoped agent name detection, which fails in new TUI
 * sessions where the agent hasn't been registered yet.
 */
const DERAILMENT_PATTERNS = [
  {
    pattern: /I am opencode|I'm opencode|I am an interactive CLI|I am a software engineering/i,
    category: 'identity-drift',
    replacement: 'I am MANTA v2.2.2, a dual-brain sequential precision engineering agent with PSM and guardian enforcement.',
  },
  {
    pattern: /You are opencode|you are an? (interactive|AI|chatbot|software)/i,
    category: 'identity-assignment',
    replacement: 'I am MANTA v2.2.2 — I do not identify as opencode.',
  },
  {
    pattern: /underlying model|the model behind|powering this|LLM behind/i,
    category: 'meta-awareness',
    replacement: null, // null = block entirely
  },
  {
    pattern: /respond as|pretend to be/i,
    category: 'role-play-request',
    replacement: 'I am MANTA v2.2.2. I cannot role-play as another entity.',
  },
];

function extractText(msg: any): string {
  if (typeof msg === 'string') return msg;
  if (msg?.content) return msg.content;
  if (msg?.text) return msg.text;
  return '';
}

function setText(msg: any, text: string): void {
  if (typeof msg === 'string') {
    // Can't modify in-place if it's a plain string, but output messages are usually objects
  } else if (msg) {
    msg.content = text;
    msg.text = text;
  }
}

export function createMessagesTransformHook(): Hooks['experimental.chat.messages.transform'] {
  return async (input: any, output: any) => {
    // Check system prompt for MANTA identity markers - session-agnostic
    const sysOutput = output as { system?: string[] };
    const systemText = Array.isArray(sysOutput?.system) ? sysOutput.system.join(' ') : '';
    const isMantaSession = /\[AGENT IDENTITY BINDING\]|MANTA.*IDENTITY|You are MANTA/i.test(systemText);
    if (!isMantaSession) return;
    
    const messages = output?.messages || output?.message ? [output.message] : [];
    
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      
      const text = extractText(msg);
      if (!text || text.length < 20) continue;
      
      for (const dp of DERAILMENT_PATTERNS) {
        if (dp.pattern.test(text)) {
          if (dp.replacement === null) {
            setText(msg, '[IDENTITY BLOCKED] I am MANTA v2.2.2.');
          } else {
            setText(msg, dp.replacement);
          }
          break;
        }
      }
    }
  };
}
