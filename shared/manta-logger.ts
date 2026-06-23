/**
 * Manta Logger — Silent file-based logger
 * 
 * Replaces console.log/warn/error throughout the plugin.
 * Writes to .manta/manta.log instead of stdout/stderr.
 * This prevents log spillover into the TUI.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const LOG_DIR = path.join(process.cwd(), '.manta');
const LOG_FILE = path.join(LOG_DIR, 'manta.log');

function ensureLogDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) { process.stderr.write('[MANTA] ensureLogDir mkdir failed\n'); }
}

export function mantaLog(...args: unknown[]): void {
  try {
    ensureLogDir();
    const msg = `[MANTA] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
    fs.appendFileSync(LOG_FILE, `${msg}\n`);
  } catch (e) { process.stderr.write('[MANTA] mantaLog write failed\n'); }
}

export function mantaWarn(...args: unknown[]): void {
  try {
    ensureLogDir();
    const msg = `[MANTA WARN] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
    fs.appendFileSync(LOG_FILE, `${msg}\n`);
  } catch (e) { process.stderr.write('[MANTA] mantaWarn write failed\n'); }
}

export function mantaError(...args: unknown[]): void {
  try {
    ensureLogDir();
    const msg = `[MANTA ERROR] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
    fs.appendFileSync(LOG_FILE, `${msg}\n`);
  } catch (e) { process.stderr.write('[MANTA] mantaError write failed\n'); }
}
