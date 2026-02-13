/**
 * Session Manager Module
 *
 * Push-based session discovery with real-time updates.
 * Uses @parcel/watcher events for incremental updates - no polling.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { OrbitConfig, Session, SessionType } from '../types.ts';
import { getConfig } from './config.ts';
import { getNewestNFiles } from './discovery.ts';
import { type DirectoryWatcher, createWatcher } from './watcher.ts';

function getSessionNamesPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	const baseDir = xdgConfig || join(homedir(), '.config');
	return join(baseDir, 'orbit', 'names.json');
}

// Session filename patterns - single source of truth
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_PATTERN = /^agent-([a-f0-9]{7,8})$/i;

/**
 * Check if a filename is a valid session file.
 * Matches: {UUID}.jsonl or agent-{7-8hex}.jsonl
 */
export function isValidSessionFilename(filename: string): boolean {
	const nameWithoutExt = filename.replace(/\.jsonl$/, '');
	return UUID_PATTERN.test(nameWithoutExt) || AGENT_PATTERN.test(nameWithoutExt);
}

/**
 * Check if a session ID is valid (for security validation).
 * Used before passing IDs to shell commands.
 */
export function isValidSessionId(id: string): boolean {
	// UUID format
	if (UUID_PATTERN.test(id)) return true;
	// Agent ID: 7-8 hex chars (extracted from agent-{hex}.jsonl)
	if (/^[a-f0-9]{7,8}$/i.test(id)) return true;
	return false;
}

export type SessionChangeListener = (sessions: Session[]) => void;

const NOTIFY_DEBOUNCE_MS = 500; // Increased to reduce SSE traffic during active sessions

export class SessionManager {
	private config: OrbitConfig;
	private sessions: Map<string, Session> = new Map();
	private sessionNames: Map<string, string> = new Map();
	private watcher: DirectoryWatcher | null = null;
	private listeners: Set<SessionChangeListener> = new Set();
	private notifyTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(config?: OrbitConfig) {
		this.config = config ?? getConfig();
		this.loadSessionNames();
	}

	/**
	 * Initialize session list using filtered discovery.
	 * Only called at startup - uses mtime-based sorting.
	 */
	initialize(): void {
		const files = getNewestNFiles(this.config.sessions.watchPath, this.config.sessions.count, {
			extension: '.jsonl',
			matchFilename: isValidSessionFilename,
		});

		// Reverse to insert oldest→newest (Map preserves insertion order)
		// Runtime events use delete+set to move to end, so newest must be at end
		files.reverse();

		this.sessions.clear();
		for (const file of files) {
			const session = this.fileToSession(file.path, file.mtimeMs);
			if (session) {
				this.sessions.set(session.id, session);
			}
		}
	}

	/**
	 * Start watching for file changes.
	 * Events trigger incremental updates - no full rescans.
	 */
	async startWatcher(): Promise<void> {
		if (this.watcher) {
			return;
		}

		this.watcher = await createWatcher(this.config.sessions.watchPath, (filePath) => {
			this.handleFileEvent(filePath);
		});
	}

	/**
	 * Stop the watcher and cleanup.
	 */
	async stopWatcher(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
		if (this.notifyTimer) {
			clearTimeout(this.notifyTimer);
			this.notifyTimer = null;
		}
	}

	/**
	 * Handle a file change event - incremental update.
	 * Handles both file modifications and deletions.
	 */
	private handleFileEvent(filePath: string): void {
		const filename = basename(filePath);

		// Quick pattern check - reject non-session files early
		if (!filename.endsWith('.jsonl')) return;
		if (!isValidSessionFilename(filename)) return;

		// Check if file still exists (handles deletion via 'rename' event)
		if (!existsSync(filePath)) {
			// File was deleted - remove from sessions if present
			const nameWithoutExt = filename.replace(/\.jsonl$/, '');
			let sessionId: string | null = null;

			if (UUID_PATTERN.test(nameWithoutExt)) {
				sessionId = nameWithoutExt;
			} else {
				const match = nameWithoutExt.match(AGENT_PATTERN);
				if (match) {
					sessionId = match[1];
				}
			}

			if (sessionId && this.sessions.has(sessionId)) {
				this.sessions.delete(sessionId);
				this.scheduleNotify();
			}
			return;
		}

		// Event time = this file is now the newest
		const eventTime = Date.now();
		const session = this.fileToSession(filePath, eventTime);
		if (!session) return;

		// Move to end of Map (newest) - delete + set preserves insertion order
		this.sessions.delete(session.id);
		this.sessions.set(session.id, session);

		// Trim to max count (oldest = first in Map)
		while (this.sessions.size > this.config.sessions.count) {
			const oldest = this.sessions.keys().next().value;
			if (oldest) {
				this.sessions.delete(oldest);
			}
		}

		// Notify listeners (debounced)
		this.scheduleNotify();
	}

	/**
	 * Get all tracked sessions, sorted by lastSeen descending.
	 * Includes session names if set.
	 */
	getSessions(): Session[] {
		// Map is ordered oldest→newest, so reverse for display
		return Array.from(this.sessions.values())
			.reverse()
			.map((session) => {
				const name = this.sessionNames.get(session.id);
				return name ? { ...session, name } : session;
			});
	}

	/**
	 * Get a specific session by ID.
	 */
	getSession(id: string): Session | undefined {
		const session = this.sessions.get(id);
		if (session) {
			const name = this.sessionNames.get(id);
			if (name) {
				return { ...session, name };
			}
		}
		return session;
	}

	/**
	 * Set the display name for a session.
	 * Notifies listeners of the change.
	 */
	setSessionName(id: string, name: string): boolean {
		if (!this.sessions.has(id)) {
			return false;
		}
		this.sessionNames.set(id, name);
		this.saveSessionNames();
		this.scheduleNotify();
		return true;
	}

	/**
	 * Get the display name for a session.
	 */
	getSessionName(id: string): string | undefined {
		return this.sessionNames.get(id);
	}

	/**
	 * Subscribe to session list changes.
	 * Returns unsubscribe function.
	 */
	onChange(listener: SessionChangeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private loadSessionNames(): void {
		const path = getSessionNamesPath();
		if (!existsSync(path)) return;
		try {
			const data = JSON.parse(readFileSync(path, 'utf-8'));
			for (const [id, name] of Object.entries(data)) {
				if (typeof name === 'string') {
					this.sessionNames.set(id, name);
				}
			}
		} catch {
			// Corrupted file — start fresh
		}
	}

	private saveSessionNames(): void {
		const path = getSessionNamesPath();
		const dir = dirname(path);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const data: Record<string, string> = {};
		for (const [id, name] of this.sessionNames) {
			data[id] = name;
		}
		const tmpPath = `${path}.tmp`;
		writeFileSync(tmpPath, JSON.stringify(data, null, 2));
		renameSync(tmpPath, path);
	}

	/**
	 * Schedule debounced notification to listeners.
	 */
	private scheduleNotify(): void {
		if (this.notifyTimer) {
			clearTimeout(this.notifyTimer);
		}
		this.notifyTimer = setTimeout(() => {
			this.notifyTimer = null;
			this.notifyListeners();
		}, NOTIFY_DEBOUNCE_MS);
	}

	/**
	 * Notify all listeners of session list change.
	 */
	private notifyListeners(): void {
		const sessions = this.getSessions();
		for (const listener of this.listeners) {
			try {
				listener(sessions);
			} catch {
				// Listener error shouldn't break others
			}
		}
	}

	/**
	 * Convert file path to Session object.
	 */
	private fileToSession(path: string, mtimeMs: number): Session | null {
		const filename = basename(path);
		const nameWithoutExt = filename.replace(/\.jsonl$/, '');

		let id: string;
		let type: SessionType;

		if (UUID_PATTERN.test(nameWithoutExt)) {
			id = nameWithoutExt;
			type = 'session';
		} else {
			const match = nameWithoutExt.match(AGENT_PATTERN);
			if (match) {
				id = match[1];
				type = 'agent';
			} else {
				return null;
			}
		}

		const now = Date.now();
		const active = now - mtimeMs < this.config.ui.activeThresholdMs;

		return {
			id,
			path,
			type,
			lastSeen: mtimeMs,
			mtime: mtimeMs,
			active,
		};
	}
}

// Singleton instance
let managerInstance: SessionManager | null = null;

export function getSessionManager(config?: OrbitConfig): SessionManager {
	if (!managerInstance) {
		managerInstance = new SessionManager(config);
	} else if (config) {
		console.warn('SessionManager already initialized, config parameter ignored');
	}
	return managerInstance;
}
