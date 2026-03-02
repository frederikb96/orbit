/**
 * Session Manager Module
 *
 * Push-based session discovery with real-time updates.
 * Uses @parcel/watcher events for incremental updates - no polling.
 */

import {
	type Dirent,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { OrbitConfig, Session, SessionType } from '../types.ts';
import { getConfig } from './config.ts';
import { getAllFilesWithMtime, getNewestNFiles } from './discovery.ts';
import { type SearchResult, scoreSession } from './search.ts';
import { type DirectoryWatcher, createWatcher } from './watcher.ts';

function getSessionNamesPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	const baseDir = xdgConfig || join(homedir(), '.config');
	return join(baseDir, 'orbit', 'names.json');
}

// Session filename patterns - single source of truth
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_PATTERN = /^agent-([a-f0-9]{7,})$/i;

/**
 * Check if a filename is a valid session file.
 * Matches: {UUID}.jsonl or agent-{hex}.jsonl (pure hex ID, 7+ chars)
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
	if (UUID_PATTERN.test(id)) return true;
	if (/^[a-f0-9]{7,}$/i.test(id)) return true;
	return false;
}

export type SessionChangeListener = (sessions: Session[]) => void;

const NOTIFY_DEBOUNCE_MS = 500;
const RESUBSCRIBE_DEBOUNCE_MS = 5_000;

export class SessionManager {
	private config: OrbitConfig;
	private sessions: Map<string, Session> = new Map();
	private sessionNames: Map<string, string> = new Map();
	private watcher: DirectoryWatcher | null = null;
	private listeners: Set<SessionChangeListener> = new Set();
	private notifyTimer: ReturnType<typeof setTimeout> | null = null;
	private resubscribeTimer: ReturnType<typeof setTimeout> | null = null;

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
		if (this.resubscribeTimer) {
			clearTimeout(this.resubscribeTimer);
			this.resubscribeTimer = null;
		}
	}

	/**
	 * Handle a file change event - incremental update.
	 * Handles .jsonl file modifications/deletions and directory creation.
	 */
	private handleFileEvent(filePath: string): void {
		const filename = basename(filePath);

		if (filename.endsWith('.jsonl')) {
			this.handleJsonlEvent(filePath, filename);
			return;
		}

		// @parcel/watcher misses subdirectories created via recursive mkdir.
		// When a new directory appears, scan it for session files and re-subscribe
		// so future events in the new subtree are detected.
		try {
			if (lstatSync(filePath).isDirectory()) {
				this.handleNewDirectory(filePath);
			}
		} catch {
			// Path vanished or permission denied
		}
	}

	private handleJsonlEvent(filePath: string, filename: string): void {
		if (!isValidSessionFilename(filename)) return;

		// Check if file still exists (handles deletion via 'rename' event)
		if (!existsSync(filePath)) {
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

		const eventTime = Date.now();
		const session = this.fileToSession(filePath, eventTime);
		if (!session) return;

		// Move to end of Map (newest) - delete + set preserves insertion order
		this.sessions.delete(session.id);
		this.sessions.set(session.id, session);

		this.trimSessions();
		this.scheduleNotify();
	}

	/**
	 * Scan a newly created directory for session files.
	 * Then re-subscribe the watcher so future events in it are detected.
	 */
	private handleNewDirectory(dirPath: string): void {
		let changed = false;

		try {
			const entries = readdirSync(dirPath, {
				recursive: true,
				withFileTypes: true,
			}) as Dirent[];

			for (const entry of entries) {
				if (!entry.isFile()) continue;
				if (!entry.name.endsWith('.jsonl')) continue;
				if (!isValidSessionFilename(entry.name)) continue;

				const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path;
				const fullPath = join(parentPath, entry.name);

				try {
					const stat = lstatSync(fullPath);
					const session = this.fileToSession(fullPath, stat.mtimeMs);
					if (!session) continue;

					this.sessions.delete(session.id);
					this.sessions.set(session.id, session);
					changed = true;
				} catch {
					// File vanished between readdir and stat
				}
			}
		} catch {
			// Directory vanished or permission denied
		}

		if (changed) {
			this.trimSessions();
			this.scheduleNotify();
		}

		this.scheduleResubscribe();
	}

	private trimSessions(): void {
		while (this.sessions.size > this.config.sessions.count) {
			const oldest = this.sessions.keys().next().value;
			if (oldest) {
				this.sessions.delete(oldest);
			}
		}
	}

	/**
	 * Debounced watcher re-subscribe to pick up new subdirectories.
	 * Creates new subscription before closing old one (zero event gap).
	 */
	private scheduleResubscribe(): void {
		if (this.resubscribeTimer) return;
		this.resubscribeTimer = setTimeout(async () => {
			this.resubscribeTimer = null;
			if (!this.watcher) return;
			try {
				// Must close before re-subscribing — @parcel/watcher doesn't
				// set up inotify watches correctly with two concurrent subscriptions
				await this.watcher.close();
				this.watcher = await createWatcher(this.config.sessions.watchPath, (fp) =>
					this.handleFileEvent(fp),
				);
			} catch {
				// Re-subscribe failed — try to restore watcher
				try {
					this.watcher = await createWatcher(this.config.sessions.watchPath, (fp) =>
						this.handleFileEvent(fp),
					);
				} catch {
					this.watcher = null;
				}
			}
		}, RESUBSCRIBE_DEBOUNCE_MS);
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
	 * Activate an untracked session by ID.
	 * Scans watchPath for the session file and adds it to the tracked set.
	 * Returns the session if found, null otherwise.
	 */
	activateSession(id: string): Session | null {
		if (this.sessions.has(id)) {
			const existing = this.sessions.get(id)!;
			const name = this.sessionNames.get(id);
			return name ? { ...existing, name } : existing;
		}

		const files = getAllFilesWithMtime(this.config.sessions.watchPath, {
			extension: '.jsonl',
			matchFilename: (filename) => {
				const nameWithoutExt = filename.replace(/\.jsonl$/, '');
				if (UUID_PATTERN.test(nameWithoutExt)) return nameWithoutExt === id;
				const match = nameWithoutExt.match(AGENT_PATTERN);
				return match ? match[1] === id : false;
			},
		});

		if (files.length === 0) return null;

		const session = this.fileToSession(files[0].path, files[0].mtimeMs);
		if (!session) return null;

		this.sessions.delete(session.id);
		this.sessions.set(session.id, session);
		this.trimSessions();
		this.scheduleNotify();

		const name = this.sessionNames.get(session.id);
		return name ? { ...session, name } : session;
	}

	/**
	 * Search all sessions on disk by fuzzy matching against ID and name.
	 * Only returns main sessions (not agents) by default.
	 */
	searchSessions(query: string, limit = 20): SearchResult[] {
		if (!query.trim()) return [];

		const files = getAllFilesWithMtime(this.config.sessions.watchPath, {
			extension: '.jsonl',
			matchFilename: (filename) => {
				const nameWithoutExt = filename.replace(/\.jsonl$/, '');
				return UUID_PATTERN.test(nameWithoutExt);
			},
		});

		const scored: { result: SearchResult; score: number }[] = [];

		for (const file of files) {
			const filename = basename(file.path);
			const nameWithoutExt = filename.replace(/\.jsonl$/, '');
			const sessionName = this.sessionNames.get(nameWithoutExt);
			const score = scoreSession(query, nameWithoutExt, sessionName);

			if (score > 0) {
				scored.push({
					result: {
						id: nameWithoutExt,
						name: sessionName,
						mtime: file.mtimeMs,
						type: 'session',
					},
					score,
				});
			}
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit).map((s) => s.result);
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
