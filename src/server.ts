/**
 * Orbit HTTP Server
 *
 * Serves the web UI and provides SSE streaming for transcripts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import pkg from '../package.json';
import { getConfig } from './lib/config.ts';
import { getLogger } from './lib/logger.ts';
import { getSessionManager } from './lib/sessions.ts';
import { DEFAULT_LIMIT, StreamingParser, parseTranscriptTail } from './lib/transcript.ts';
import type { SessionInfo } from './types/index.ts';

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
};

interface SSEClient {
	id: string;
	sessionId: string;
	controller: ReadableStreamDefaultController;
	cleanup: () => void;
}

// Session cache refresh interval (ms) - balance freshness vs CPU
// Discovery scans all files, so can't be too frequent
const SESSION_REFRESH_INTERVAL_MS = 30_000;

class OrbitServer {
	private port: number;
	private publicDir: string;
	private clients: Map<string, SSEClient> = new Map();
	private sessionManager = getSessionManager();
	private logger = getLogger();
	private server: ReturnType<typeof Bun.serve> | null = null;
	private clientCounter = 0;
	private refreshInterval: ReturnType<typeof setInterval> | null = null;

	constructor(port: number) {
		this.port = port;
		// Public dir relative to this file's location
		this.publicDir = join(import.meta.dir, '..', 'public');
	}

	async start(): Promise<void> {
		this.logger.serverStart(this.port);

		// Discover sessions on start
		await this.sessionManager.discover();

		// Background refresh of session cache (fast - only scans for newest files)
		this.refreshInterval = setInterval(() => {
			this.sessionManager.discover().catch((err) => {
				this.logger.debug('session_refresh_error', {
					error: err instanceof Error ? err.message : String(err),
				});
			});
		}, SESSION_REFRESH_INTERVAL_MS);

		this.server = Bun.serve({
			hostname: 'localhost',
			port: this.port,
			fetch: async (req) => {
				const start = performance.now();
				const url = new URL(req.url);
				const path = url.pathname;

				try {
					let response: Response;

					// API routes
					if (path.startsWith('/api/')) {
						response = await this.handleAPI(req, path);
					}
					// Static files
					else {
						response = this.handleStatic(path);
					}

					const duration = performance.now() - start;
					this.logger.request(req.method, path, response.status, Math.round(duration));
					return response;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this.logger.errorOccurred('request_error', message, { path });
					return new Response(JSON.stringify({ error: message }), {
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			},
		});

		console.log(`Orbit server running at http://localhost:${this.port}`);
	}

	stop(): void {
		// Stop background refresh
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
			this.refreshInterval = null;
		}

		// Close all SSE connections
		for (const client of this.clients.values()) {
			client.cleanup();
			try {
				client.controller.close();
			} catch {
				// Already closed
			}
		}
		this.clients.clear();

		// Close server
		this.server?.stop();
		this.sessionManager.cleanup();
		this.logger.serverStop('shutdown');
	}

	private async handleAPI(req: Request, path: string): Promise<Response> {
		// GET /api/health - Health check
		if (path === '/api/health' && req.method === 'GET') {
			return Response.json({ status: 'ok', version: pkg.version });
		}

		// GET /api/config - Client configuration
		if (path === '/api/config' && req.method === 'GET') {
			const config = getConfig();
			return Response.json(config.ui);
		}

		// GET /api/sessions - List all sessions (from cache, instant)
		if (path === '/api/sessions' && req.method === 'GET') {
			const config = getConfig();
			const sessions = this.sessionManager.getSessions(config.ui.maxSessions);
			return Response.json(sessions);
		}

		// GET /api/sessions/:id - Get session info
		const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
		if (sessionMatch && req.method === 'GET') {
			const id = sessionMatch[1];
			const session = await this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}
			return Response.json(session);
		}

		// GET /api/sessions/:id/entries - Paginated entries (tail loading)
		const entriesMatch = path.match(/^\/api\/sessions\/([^/]+)\/entries$/);
		if (entriesMatch && req.method === 'GET') {
			const id = entriesMatch[1];
			const session = await this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}

			const url = new URL(req.url);
			const limit = Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
			const before = url.searchParams.get('before');
			const beforeByte = before ? Number.parseInt(before, 10) : undefined;

			const result = await parseTranscriptTail(session.path, limit, beforeByte);
			return Response.json(result);
		}

		// GET /api/sessions/:id/stream - SSE stream
		const streamMatch = path.match(/^\/api\/sessions\/([^/]+)\/stream$/);
		if (streamMatch && req.method === 'GET') {
			const id = streamMatch[1];
			const session = await this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}

			return this.createSSEStream(session);
		}

		return Response.json({ error: 'Not found' }, { status: 404 });
	}

	private createSSEStream(session: SessionInfo): Response {
		const clientId = `client-${++this.clientCounter}`;
		let lastPosition = 0;
		let isInitialized = false;
		// Parser will be initialized with correct byte offset after initial load
		const parser = new StreamingParser(0);
		let pingInterval: ReturnType<typeof setInterval> | null = null;
		const encoder = new TextEncoder();

		const stream = new ReadableStream({
			start: (controller) => {
				// Set up file watcher (debounced at 100ms in SessionManager)
				const cleanup = this.sessionManager.watchSession(session.id, async () => {
					// Skip if not initialized yet (avoid race with initial load)
					if (!isInitialized) return;

					try {
						const file = Bun.file(session.path);
						const size = file.size;

						// Handle file truncation (rotation)
						if (size < lastPosition) {
							lastPosition = 0;
							parser.setByteOffset(0);
							try {
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ type: 'truncated', sessionId: session.id })}\n\n`,
									),
								);
							} catch {
								// Client disconnected
								return;
							}
						}

						// No new data
						if (size <= lastPosition) return;

						const content = await file.slice(lastPosition).text();
						lastPosition = size;

						const entries = parser.parse(content);
						if (entries.length === 0) return;

						// Send as batch with session ID (client processes in single state update)
						try {
							const batchData = `data: ${JSON.stringify({ type: 'batch', entries, sessionId: session.id })}\n\n`;
							controller.enqueue(encoder.encode(batchData));
						} catch {
							// Client disconnected - cleanup will happen in cancel()
						}
					} catch (err) {
						this.logger.debug('sse_file_watch_error', {
							session_id: session.id,
							client_id: clientId,
							error: err instanceof Error ? err.message : String(err),
						});
					}
				});

				// Store client
				this.clients.set(clientId, {
					id: clientId,
					sessionId: session.id,
					controller,
					cleanup,
				});

				this.logger.sseConnect(session.id, clientId);

				// Send initial transcript (tail only for performance)
				(async () => {
					try {
						const file = Bun.file(session.path);
						lastPosition = file.size;
						const { entries, cursor, hasMore } = await parseTranscriptTail(
							session.path,
							DEFAULT_LIMIT,
						);

						// Set parser's byte offset for streaming new entries with correct IDs
						parser.setByteOffset(lastPosition);

						// Send initial entries with pagination info and session ID
						const initData = `data: ${JSON.stringify({ type: 'init', entries, cursor, hasMore, sessionId: session.id })}\n\n`;
						controller.enqueue(encoder.encode(initData));

						// Mark as initialized - now file watcher callbacks can process
						isInitialized = true;

						// Catch any file changes that occurred during init (race condition fix)
						const currentFile = Bun.file(session.path);
						const currentSize = currentFile.size;
						if (currentSize > lastPosition) {
							const missedContent = await currentFile.slice(lastPosition).text();
							lastPosition = currentSize;
							const missedEntries = parser.parse(missedContent);
							if (missedEntries.length > 0) {
								try {
									const batchData = `data: ${JSON.stringify({ type: 'batch', entries: missedEntries, sessionId: session.id })}\n\n`;
									controller.enqueue(encoder.encode(batchData));
								} catch {
									// Client disconnected
								}
							}
						}
					} catch (err) {
						this.logger.debug('sse_initial_read_error', {
							session_id: session.id,
							client_id: clientId,
							error: err instanceof Error ? err.message : String(err),
						});
					}
				})();

				// Keep-alive ping every 30s
				pingInterval = setInterval(() => {
					try {
						controller.enqueue(new TextEncoder().encode(': ping\n\n'));
					} catch {
						if (pingInterval) clearInterval(pingInterval);
					}
				}, 30_000);
			},
			cancel: () => {
				// Clear ping interval to prevent memory leak
				if (pingInterval) {
					clearInterval(pingInterval);
					pingInterval = null;
				}

				const client = this.clients.get(clientId);
				if (client) {
					client.cleanup();
					this.clients.delete(clientId);
					this.logger.sseDisconnect(session.id, clientId);
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

	private handleStatic(path: string): Response {
		// Default to index.html
		const filePath = path === '/' ? '/index.html' : path;
		const fullPath = join(this.publicDir, filePath);

		// Security: prevent directory traversal
		if (!fullPath.startsWith(this.publicDir)) {
			return new Response('Forbidden', { status: 403 });
		}

		if (!existsSync(fullPath)) {
			// SPA fallback - serve index.html for unknown routes
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
}

export { OrbitServer };
