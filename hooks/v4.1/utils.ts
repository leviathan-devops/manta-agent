/**
 * Hook utilities for Manta v2.2
 * 
 * Helper functions for extracting data from OpenCode hook inputs.
 */

export function extractPathFromToolArgs(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const a = args as Record<string, unknown>;
  return (typeof a.path === 'string' ? a.path : null) || (typeof a.workdir === 'string' ? a.workdir : null);
}

export function extractCommandFromArgs(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const a = args as Record<string, unknown>;
  return (typeof a.command === 'string' ? a.command : null) || (typeof a.cmd === 'string' ? a.cmd : null);
}

export function isBuildTool(tool: string): boolean {
  const buildTools = ['write_file', 'mcp_write_file', 'patch', 'mcp_patch', 'terminal', 'mcp_terminal', 'cp', 'mv', 'mkdir'];
  return buildTools.includes(tool);
}

export function isTestTool(tool: string, args: unknown): boolean {
  if (tool !== 'terminal' && tool !== 'mcp_terminal') return false;
  const cmd = extractCommandFromArgs(args) || '';
  return /\b(test|jest|vitest|pytest|ruby|rspec)\b/.test(cmd);
}
