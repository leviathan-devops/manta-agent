/**
 * Hook utilities for Manta v2.2.2
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

