// Session Discovery Module
// Discovers and watches Claude Code transcript files

import { type FSWatcher, watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname } from 'node:path';
import { Glob } from 'bun';
import type { SessionInfo, SessionType } from '../types/index.ts';
import { getLogger } from './logger.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_ID_REGEX = /^agent-([a-f0-9]+)\.jsonl$/;
const ACTIVE_THRESHOLD_MS = 60_000; // 60 seconds

export class SessionManager {
	private home: string;
	private sessions: Map<string, SessionInfo> = new Map();
	private watchers: Map<string, FSWatcher> = new Map();
	private updateCallbacks: Set<(sessions: SessionInfo[]) => void> = new Set();
	private fileCallbacks: Map<string, Set<(path: string) => void>> = new Map();

	constructor() {
		this.home = homedir();
	}

	/**
	 * Discover all available sessions
	 */
	async discover(): Promise<SessionInfo[]> {
		const logger = getLogger();
		const sessions: SessionInfo[] = [];

		// Session patterns
		const patterns = [
			`${this.home}/.claude/projects/*/*.jsonl`,
			`${this.home}/.claude/projects/*/agent-*.jsonl`,
			`${this.home}/.claude/projects/*/subagents/agent-*.jsonl`,
			`${this.home}/.claude/projects/*/*/subagents/agent-*.jsonl`,
			'/tmp/claude/*/tasks/*.output',
		];

		for (const pattern of patterns) {
			const glob = new Glob(pattern);
			for await (const path of glob.scan({ absolute: true })) {
				const info = await this.getSessionInfo(path);
				if (info) {
					sessions.push(info);
					logger.sessionDiscovered(info.id, info.type, path);
				}
			}
		}

		// Update internal map
		this.sessions.clear();
		for (const session of sessions) {
			this.sessions.set(session.id, session);
		}

		// Sort by mtime descending (most recent first)
		return sessions.sort((a, b) => b.mtime - a.mtime);
	}

	/**
	 * Get session info from a file path
	 */
	private async getSessionInfo(path: string): Promise<SessionInfo | null> {
		try {
			const stats = await stat(path);
			const filename = basename(path);
			const mtime = stats.mtimeMs;
			const now = Date.now();

			// Determine type and extract ID
			let id: string;
			let type: SessionType;

			// Check if it's a UUID (session)
			const nameWithoutExt = filename.replace(/\.(jsonl|output)$/, '');
			if (UUID_REGEX.test(nameWithoutExt)) {
				id = nameWithoutExt;
				type = 'session';
			} else {
				// Agent file
				const match = filename.match(AGENT_ID_REGEX);
				if (match) {
					id = match[1];
					type = 'agent';
				} else if (filename.endsWith('.output')) {
					// /tmp/claude/*/tasks/<id>.output
					id = nameWithoutExt;
					type = 'agent';
				} else {
					return null;
				}
			}

			return {
				id,
				type,
				path,
				mtime,
				size: stats.size,
				active: now - mtime < ACTIVE_THRESHOLD_MS,
			};
		} catch (err) {
			getLogger().debug('session_stat_error', {
				path,
				error: err instanceof Error ? err.message : String(err),
			});
			return null;
		}
	}

	/**
	 * Get a specific session by ID
	 */
	async getSession(id: string): Promise<SessionInfo | null> {
		// Check cache first
		const cached = this.sessions.get(id);
		if (cached) {
			// Refresh stats
			const info = await this.getSessionInfo(cached.path);
			if (info) {
				this.sessions.set(id, info);
				return info;
			}
		}

		// Try to find it
		const sessions = await this.discover();
		return sessions.find((s) => s.id === id) || null;
	}

	/**
	 * Watch a specific session file for changes
	 */
	watchSession(sessionId: string, callback: (path: string) => void): () => void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return () => {};
		}

		// Add callback to set
		let callbacks = this.fileCallbacks.get(session.path);
		if (!callbacks) {
			callbacks = new Set();
			this.fileCallbacks.set(session.path, callbacks);
		}
		callbacks.add(callback);

		// Start watcher if not already watching
		if (!this.watchers.has(session.path)) {
			try {
				const watcher = watch(session.path, (event) => {
					if (event === 'change') {
						const cbs = this.fileCallbacks.get(session.path);
						if (cbs) {
							for (const cb of cbs) {
								cb(session.path);
							}
						}
					}
				});
				this.watchers.set(session.path, watcher);
			} catch (err) {
				getLogger().debug('session_watch_error', {
					session_id: sessionId,
					path: session.path,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		// Return cleanup function
		return () => {
			callbacks?.delete(callback);
			if (callbacks?.size === 0) {
				this.fileCallbacks.delete(session.path);
				const watcher = this.watchers.get(session.path);
				if (watcher) {
					watcher.close();
					this.watchers.delete(session.path);
				}
			}
		};
	}

	/**
	 * Subscribe to session list updates
	 */
	onUpdate(callback: (sessions: SessionInfo[]) => void): () => void {
		this.updateCallbacks.add(callback);
		return () => this.updateCallbacks.delete(callback);
	}

	/**
	 * Refresh and notify subscribers
	 */
	async refresh(): Promise<SessionInfo[]> {
		const sessions = await this.discover();
		for (const callback of this.updateCallbacks) {
			callback(sessions);
		}
		return sessions;
	}

	/**
	 * Clean up all watchers
	 */
	cleanup(): void {
		for (const watcher of this.watchers.values()) {
			watcher.close();
		}
		this.watchers.clear();
		this.fileCallbacks.clear();
		this.updateCallbacks.clear();
	}

	/**
	 * Get project directory from session path
	 */
	getProjectDir(session: SessionInfo): string {
		// Extract project directory from path
		// e.g., ~/.claude/projects/-home-user-myproject/session.jsonl → /home/user/myproject
		const dir = dirname(session.path);
		const projectPart = basename(dir).replace(/^-/, '').replace(/-/g, '/');
		return `/${projectPart}`;
	}
}

// Singleton instance
let managerInstance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
	if (!managerInstance) {
		managerInstance = new SessionManager();
	}
	return managerInstance;
}
