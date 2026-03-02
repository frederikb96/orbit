/**
 * Orbit HTTP Server
 *
 * Bun.serve() based HTTP server for the Orbit web UI.
 * Serves static files and provides REST API for session/transcript data.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getConfig } from '../lib/config.ts';
import { getSessionManager, isValidSessionId } from '../lib/sessions.ts';
import { parseTranscriptTail } from '../lib/transcript.ts';
import { removePid, writePid } from '../shared/state.ts';
import type { OrbitConfig, Session } from '../types.ts';
import { createSSEHandler } from './sse.ts';

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
};

// Session list SSE client
interface SessionListClient {
	controller: ReadableStreamDefaultController;
	pingInterval: ReturnType<typeof setInterval>;
}

// Keepalive ping interval - 15 seconds prevents browser/proxy timeouts
const KEEP_ALIVE_INTERVAL_MS = 15_000;

// Max file size for archive endpoint (100MB) - prevents DoS from huge transcripts
const ARCHIVE_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

export class OrbitServer {
	private config: OrbitConfig;
	private publicDir: string;
	private server: ReturnType<typeof Bun.serve> | null = null;
	private sessionManager = getSessionManager();
	private sseHandler = createSSEHandler();
	private sessionListClients: Map<string, SessionListClient> = new Map();
	private sessionListClientCounter = 0;
	private unsubscribeSessionChanges: (() => void) | null = null;
	private pendingSelectSession: { id: string; timestamp: number } | null = null;

	constructor(config?: OrbitConfig) {
		this.config = config ?? getConfig();
		this.publicDir = join(import.meta.dir, '..', '..', 'public');
	}

	/**
	 * Start the HTTP server.
	 */
	async start(): Promise<void> {
		// Initialize session manager
		this.sessionManager.initialize();
		await this.sessionManager.startWatcher();

		// Subscribe to session changes for SSE broadcast
		this.unsubscribeSessionChanges = this.sessionManager.onChange((sessions) => {
			this.broadcastSessionList(sessions);
		});

		// Support ORBIT_PORT env var for CLI
		const port = process.env.ORBIT_PORT
			? Number.parseInt(process.env.ORBIT_PORT, 10)
			: this.config.server.port;

		this.server = Bun.serve({
			hostname: 'localhost',
			port,
			idleTimeout: 255,
			fetch: async (req) => {
				const url = new URL(req.url);
				const path = url.pathname;

				try {
					// API routes
					if (path.startsWith('/api/')) {
						return await this.handleAPI(req, path, url);
					}

					// Static files
					return this.handleStatic(path);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return Response.json({ error: message }, { status: 500 });
				}
			},
		});

		writePid(process.pid);
		console.log(`Orbit server running at http://localhost:${port}`);
	}

	/**
	 * Stop the server.
	 */
	async stop(): Promise<void> {
		// Close session list SSE clients
		for (const [clientId, client] of this.sessionListClients) {
			clearInterval(client.pingInterval);
			try {
				client.controller.close();
			} catch {
				// Already closed
			}
		}
		this.sessionListClients.clear();

		// Unsubscribe from session changes
		if (this.unsubscribeSessionChanges) {
			this.unsubscribeSessionChanges();
			this.unsubscribeSessionChanges = null;
		}

		this.sseHandler.closeAll();
		await this.sessionManager.stopWatcher();
		this.server?.stop();
		this.server = null;
		removePid();
	}

	/**
	 * Handle API requests.
	 */
	private async handleAPI(req: Request, path: string, url: URL): Promise<Response> {
		// GET /api/health
		if (path === '/api/health' && req.method === 'GET') {
			return Response.json({ status: 'ok' });
		}

		// GET /api/config - UI configuration
		if (path === '/api/config' && req.method === 'GET') {
			return Response.json(this.config.ui);
		}

		// GET /api/sessions - List sessions (excludes internal path field)
		if (path === '/api/sessions' && req.method === 'GET') {
			const sessions = this.sessionManager.getSessions();
			const clientSessions = sessions.map(({ path: _path, ...rest }) => rest);
			return Response.json(clientSessions);
		}

		// GET /api/sessions/stream - SSE stream for session list updates
		if (path === '/api/sessions/stream' && req.method === 'GET') {
			return this.createSessionListStream();
		}

		// GET /api/sessions/:id - Get session info (excludes internal path field)
		const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
		if (sessionMatch && req.method === 'GET') {
			const id = sessionMatch[1];
			const session = this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}
			const { path: _path, ...clientSession } = session;
			return Response.json(clientSession);
		}

		// GET /api/sessions/:id/entries - Paginated transcript entries
		const entriesMatch = path.match(/^\/api\/sessions\/([^/]+)\/entries$/);
		if (entriesMatch && req.method === 'GET') {
			const id = entriesMatch[1];
			const session = this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}

			const limitParam = url.searchParams.get('limit');
			const limit = limitParam
				? Number.parseInt(limitParam, 10)
				: this.config.transcript.initialLines;
			const before = url.searchParams.get('before');
			const beforeByte = before ? Number.parseInt(before, 10) : undefined;

			const result = await parseTranscriptTail(session.path, limit, beforeByte);
			return Response.json(result);
		}

		// GET /api/sessions/:id/stream - SSE stream (legacy, sends init batch)
		const streamMatch = path.match(/^\/api\/sessions\/([^/]+)\/stream$/);
		if (streamMatch && req.method === 'GET') {
			const id = streamMatch[1];
			const session = this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}

			return this.sseHandler.createStream(session, this.config);
		}

		// GET /api/sessions/:id/live - Live SSE stream (V3 mode, no init batch)
		const liveMatch = path.match(/^\/api\/sessions\/([^/]+)\/live$/);
		if (liveMatch && req.method === 'GET') {
			const id = liveMatch[1];
			const session = this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}

			return this.sseHandler.createLiveStream(session);
		}

		// GET /api/sessions/:id/archive - Paginated historical entries (V3 mode)
		const archiveMatch = path.match(/^\/api\/sessions\/([^/]+)\/archive$/);
		if (archiveMatch && req.method === 'GET') {
			const id = archiveMatch[1];
			const session = this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}

			// Query params
			const snapshotParam = url.searchParams.get('snapshot');
			if (!snapshotParam) {
				return Response.json({ error: 'snapshot parameter is required' }, { status: 400 });
			}
			const snapshot = Number.parseInt(snapshotParam, 10);
			if (Number.isNaN(snapshot)) {
				return Response.json({ error: 'Invalid snapshot parameter' }, { status: 400 });
			}

			const lastParam = url.searchParams.get('last');
			const beforeParam = url.searchParams.get('before');
			const limitParam = url.searchParams.get('limit');

			const limit = Math.min(Math.max(1, Number.parseInt(limitParam || '50', 10)), 200);

			return await this.handleArchiveRequest(session, snapshot, lastParam, beforeParam, limit);
		}

		// POST /api/sessions/:id/name - Set session display name
		const nameMatch = path.match(/^\/api\/sessions\/([^/]+)\/name$/);
		if (nameMatch && req.method === 'POST') {
			const id = nameMatch[1];

			if (!isValidSessionId(id)) {
				return Response.json({ error: 'Invalid session ID' }, { status: 400 });
			}

			try {
				const body = (await req.json()) as { name: string };
				if (!body.name || typeof body.name !== 'string') {
					return Response.json({ error: 'Name is required' }, { status: 400 });
				}

				const success = this.sessionManager.setSessionName(id, body.name.trim());
				if (!success) {
					return Response.json({ error: 'Session not found' }, { status: 404 });
				}

				return Response.json({ success: true });
			} catch {
				return Response.json({ error: 'Invalid request body' }, { status: 400 });
			}
		}

		// POST /api/select-session/:id - Remote session selection via API
		const selectMatch = path.match(/^\/api\/select-session\/([^/]+)$/);
		if (selectMatch && req.method === 'POST') {
			const id = selectMatch[1];

			if (!isValidSessionId(id)) {
				return Response.json({ error: 'Invalid session ID' }, { status: 400 });
			}

			this.broadcastSelectSession(id);
			return Response.json({ success: true });
		}

		// POST /api/session-titles - Batch fetch titles
		if (path === '/api/session-titles' && req.method === 'POST') {
			const command = this.config.ui.sessionTitleCommand;
			if (!command) {
				return Response.json({ titles: {} });
			}

			try {
				const body = (await req.json()) as { sessionIds: string[] };
				const titles: Record<string, string | null> = {};

				// Validate and filter session IDs to prevent command injection
				const validSessionIds = body.sessionIds.filter(isValidSessionId);

				// Execute command for each valid session (in parallel)
				const results = await Promise.allSettled(
					validSessionIds.map(async (sessionId) => {
						const title = await this.executeSessionTitleCommand(command, sessionId);
						return { sessionId, title };
					}),
				);

				for (const result of results) {
					if (result.status === 'fulfilled') {
						titles[result.value.sessionId] = result.value.title;
					}
				}

				return Response.json({ titles });
			} catch {
				return Response.json({ error: 'Invalid request' }, { status: 400 });
			}
		}

		return Response.json({ error: 'Not found' }, { status: 404 });
	}

	/**
	 * Handle static file requests.
	 */
	private handleStatic(path: string): Response {
		const filePath = path === '/' ? '/index.html' : path;
		const fullPath = join(this.publicDir, filePath);

		// Security: prevent directory traversal
		if (!fullPath.startsWith(this.publicDir)) {
			return new Response('Forbidden', { status: 403 });
		}

		if (!existsSync(fullPath)) {
			// SPA fallback
			const indexPath = join(this.publicDir, 'index.html');
			if (existsSync(indexPath)) {
				const content = readFileSync(indexPath, 'utf-8');
				return new Response(content, {
					headers: { 'Content-Type': 'text/html' },
				});
			}
			return new Response('Not found', { status: 404 });
		}

		const content = readFileSync(fullPath);
		const ext = extname(filePath);
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		return new Response(content, {
			headers: { 'Content-Type': contentType },
		});
	}

	/**
	 * Create SSE stream for session list updates.
	 */
	private createSessionListStream(): Response {
		const clientId = `session-list-${++this.sessionListClientCounter}`;
		const encoder = new TextEncoder();

		const stream = new ReadableStream({
			start: (controller) => {
				// Send initial session list
				const sessions = this.sessionManager.getSessions();
				const clientSessions = sessions.map(({ path: _path, ...rest }) => rest);
				const initData = `data: ${JSON.stringify({ type: 'sessions', sessions: clientSessions })}\n\n`;
				controller.enqueue(encoder.encode(initData));

				// Deliver pending session selection (from cold start)
				const pending = this.pendingSelectSession;
				if (pending && Date.now() - pending.timestamp < 10_000) {
					const selectData = `data: ${JSON.stringify({ type: 'select-session', sessionId: pending.id })}\n\n`;
					controller.enqueue(encoder.encode(selectData));
				}
				this.pendingSelectSession = null;

				// Keep-alive ping
				const pingInterval = setInterval(() => {
					try {
						controller.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'));
					} catch {
						// Client disconnected - cleanup
						clearInterval(pingInterval);
						this.sessionListClients.delete(clientId);
					}
				}, KEEP_ALIVE_INTERVAL_MS);

				// Store client
				this.sessionListClients.set(clientId, { controller, pingInterval });
			},
			cancel: () => {
				const client = this.sessionListClients.get(clientId);
				if (client) {
					clearInterval(client.pingInterval);
					this.sessionListClients.delete(clientId);
				}
			},
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	}

	/**
	 * Broadcast session selection to all connected SSE clients.
	 * If no clients are connected, queues the selection for the next connecting client.
	 */
	private broadcastSelectSession(sessionId: string): void {
		if (this.sessionListClients.size === 0) {
			this.pendingSelectSession = { id: sessionId, timestamp: Date.now() };
			return;
		}

		const data = `data: ${JSON.stringify({ type: 'select-session', sessionId })}\n\n`;
		const encoder = new TextEncoder();
		const encoded = encoder.encode(data);

		for (const [clientId, client] of this.sessionListClients) {
			try {
				client.controller.enqueue(encoded);
			} catch {
				clearInterval(client.pingInterval);
				this.sessionListClients.delete(clientId);
			}
		}
	}

	/**
	 * Broadcast session list to all connected SSE clients.
	 */
	private broadcastSessionList(sessions: Session[]): void {
		const clientSessions = sessions.map(({ path: _path, ...rest }) => rest);
		const data = `data: ${JSON.stringify({ type: 'sessions', sessions: clientSessions })}\n\n`;
		const encoder = new TextEncoder();
		const encoded = encoder.encode(data);

		for (const [clientId, client] of this.sessionListClients) {
			try {
				client.controller.enqueue(encoded);
			} catch {
				// Client disconnected, clean up
				clearInterval(client.pingInterval);
				this.sessionListClients.delete(clientId);
			}
		}
	}

	/**
	 * Handle archive request for paginated historical entries.
	 *
	 * @param session - Session to fetch entries from
	 * @param snapshot - Snapshot timestamp (entries must be before this time)
	 * @param lastParam - If provided, return last N entries
	 * @param beforeParam - If provided, return entries before this cursor (timestamp)
	 * @param limit - Max entries to return
	 */
	private async handleArchiveRequest(
		session: Session,
		snapshot: number,
		lastParam: string | null,
		beforeParam: string | null,
		limit: number,
	): Promise<Response> {
		try {
			// Guard against DoS: check file size before loading entire transcript
			const fileSize = Bun.file(session.path).size;
			if (fileSize > ARCHIVE_MAX_FILE_SIZE_BYTES) {
				const sizeMB = Math.round(fileSize / 1024 / 1024);
				return Response.json(
					{
						error: `Transcript too large (${sizeMB}MB). Use Live mode for real-time streaming instead.`,
						code: 'FILE_TOO_LARGE',
						sizeMB,
					},
					{ status: 413 },
				);
			}

			const snapshotTimestamp = Date.now();

			// Parse all entries from file (limit 0 = all)
			const { entries: allEntries } = await parseTranscriptTail(session.path, 0);

			// Filter entries by snapshot time
			const filteredEntries = allEntries.filter((entry) => {
				if (!entry.timestamp) return true;
				const entryTime = new Date(entry.timestamp).getTime();
				return entryTime < snapshot;
			});

			const totalCount = filteredEntries.length;

			let resultEntries: typeof filteredEntries;
			let hasMore: boolean;
			let nextCursor: string | null = null;

			if (lastParam !== null) {
				// Return last N entries
				const last = Math.min(Math.max(1, Number.parseInt(lastParam, 10) || limit), 200);
				const startIdx = Math.max(0, filteredEntries.length - last);
				resultEntries = filteredEntries.slice(startIdx);
				hasMore = startIdx > 0;
				if (hasMore && resultEntries.length > 0) {
					nextCursor = resultEntries[0].timestamp;
				}
			} else if (beforeParam !== null) {
				// Return entries before cursor
				const beforeTime = new Date(beforeParam).getTime();
				const entriesBeforeCursor = filteredEntries.filter((entry) => {
					if (!entry.timestamp) return false;
					const entryTime = new Date(entry.timestamp).getTime();
					return entryTime < beforeTime;
				});

				const startIdx = Math.max(0, entriesBeforeCursor.length - limit);
				resultEntries = entriesBeforeCursor.slice(startIdx);
				hasMore = startIdx > 0;
				if (hasMore && resultEntries.length > 0) {
					nextCursor = resultEntries[0].timestamp;
				}
			} else {
				// Default: return last `limit` entries
				const startIdx = Math.max(0, filteredEntries.length - limit);
				resultEntries = filteredEntries.slice(startIdx);
				hasMore = startIdx > 0;
				if (hasMore && resultEntries.length > 0) {
					nextCursor = resultEntries[0].timestamp;
				}
			}

			return Response.json({
				entries: resultEntries,
				snapshotTimestamp,
				totalCount,
				hasMore,
				nextCursor,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return Response.json({ error: message }, { status: 500 });
		}
	}

	/**
	 * Execute a command to get session title.
	 * Command should output just the title string (empty output = no title).
	 * {sessionId} placeholder is replaced with the actual session ID.
	 *
	 * SECURITY: sessionId must be validated before calling this method.
	 */
	private async executeSessionTitleCommand(
		commandTemplate: string,
		sessionId: string,
	): Promise<string | null> {
		try {
			const command = commandTemplate.replace(/\{sessionId\}/g, sessionId);

			const proc = Bun.spawn(['sh', '-c', command], {
				stdout: 'pipe',
				stderr: 'pipe',
			});

			const output = await new Response(proc.stdout).text();
			const stderr = await new Response(proc.stderr).text();
			const exitCode = await proc.exited;

			if (exitCode !== 0) {
				if (stderr) {
					console.error(`Session title command failed for ${sessionId}: ${stderr.trim()}`);
				}
				return null;
			}

			const title = output.trim();
			if (!title) {
				return null;
			}

			return title;
		} catch (err) {
			console.error(`Session title command error for ${sessionId}:`, err);
			return null;
		}
	}
}

/**
 * Create and start a new server instance.
 */
export async function startServer(config?: OrbitConfig): Promise<OrbitServer> {
	const server = new OrbitServer(config);
	await server.start();
	return server;
}

// Auto-start when run directly
if (import.meta.main) {
	startServer();
}
