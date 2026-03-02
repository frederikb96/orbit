/**
 * Shared State Paths
 *
 * Centralized paths for runtime state files.
 * Used by both CLI and server.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const STATE_DIR = join(homedir(), '.local', 'state', 'orbit');
export const PID_FILE = join(STATE_DIR, 'pid');

export function ensureStateDir(): void {
	if (!existsSync(STATE_DIR)) {
		mkdirSync(STATE_DIR, { recursive: true });
	}
}

export function readPid(): number | null {
	if (!existsSync(PID_FILE)) return null;
	try {
		const content = readFileSync(PID_FILE, 'utf-8').trim();
		const pid = Number.parseInt(content, 10);
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

export function writePid(pid: number): void {
	ensureStateDir();
	writeFileSync(PID_FILE, String(pid));
}

export function removePid(): void {
	if (existsSync(PID_FILE)) {
		unlinkSync(PID_FILE);
	}
}
