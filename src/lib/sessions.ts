/**
 * Session Manager Module
 *
 * Manages session discovery, caching, and watching.
 * Uses discovery.ts for efficient file scanning.
 */

import { type FSWatcher, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { OrbitConfig, Session, SessionType } from '../types.ts';
import { EventBuffer } from './buffer.ts';
import { getConfig } from './config.ts';
import { getNewestNFiles } from './discovery.ts';
import { createWatcher } from './watcher.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_ID_REGEX = /^agent-([a-f0-9]+)\.jsonl$/;

export class SessionManager {
	private config: OrbitConfig;
	private sessions: Map<string, Session> = new Map();
	private watcher: FSWatcher | null = null;
	private buffer = new EventBuffer();
	private refreshTimer: ReturnType<typeof setInterval> | null = null;

	constructor(config?: OrbitConfig) {
		this.config = config ?? getConfig();
	}

	/**
	 * Initialize session list using getNewestNFiles.
	 */
	initialize(): void {
		const files = getNewestNFiles(this.config.sessions.watchPath, this.config.sessions.count, {
			extension: '.jsonl',
		});

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
	 */
	startWatcher(): void {
		if (this.watcher) {
			return;
		}

		this.watcher = createWatcher(this.config.sessions.watchPath, (filePath) => {
			if (filePath.endsWith('.jsonl')) {
				this.buffer.push(filePath);
			}
		});

		// Start periodic refresh
		if (this.config.sessions.refreshIntervalMs > 0) {
			this.refreshTimer = setInterval(() => {
				this.refresh();
			}, this.config.sessions.refreshIntervalMs);
		}
	}

	/**
	 * Stop the watcher and cleanup.
	 */
	stopWatcher(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	/**
	 * Consume buffer events and update session list.
	 * Re-discovers to ensure proper sorting by mtime.
	 */
	refresh(): void {
		const changedPaths = this.buffer.consume();

		if (changedPaths.length === 0) {
			return;
		}

		// Re-run discovery to get properly sorted list
		this.initialize();
	}

	/**
	 * Get all tracked sessions, sorted by lastSeen descending.
	 * Excludes empty sessions (size === 0).
	 */
	getSessions(): Session[] {
		return Array.from(this.sessions.values())
			.filter((s) => s.size > 0)
			.sort((a, b) => b.lastSeen - a.lastSeen);
	}

	/**
	 * Get a specific session by ID.
	 */
	getSession(id: string): Session | undefined {
		return this.sessions.get(id);
	}

	/**
	 * Convert file path to Session object.
	 */
	private fileToSession(path: string, mtimeMs: number): Session | null {
		const filename = basename(path);
		const nameWithoutExt = filename.replace(/\.jsonl$/, '');

		let id: string;
		let type: SessionType;

		if (UUID_REGEX.test(nameWithoutExt)) {
			id = nameWithoutExt;
			type = 'session';
		} else {
			const match = filename.match(AGENT_ID_REGEX);
			if (match) {
				id = match[1];
				type = 'agent';
			} else {
				return null;
			}
		}

		// Get file size
		let size = 0;
		try {
			const stat = statSync(path);
			size = stat.size;
		} catch {
			// File may have been deleted
		}

		const now = Date.now();
		const active = now - mtimeMs < this.config.sessions.activeThresholdMs;

		return {
			id,
			path,
			type,
			lastSeen: mtimeMs,
			mtime: mtimeMs,
			size,
			active,
		};
	}
}

// Singleton instance
let managerInstance: SessionManager | null = null;

export function getSessionManager(config?: OrbitConfig): SessionManager {
	if (!managerInstance) {
		managerInstance = new SessionManager(config);
	}
	return managerInstance;
}
