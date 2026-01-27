/**
 * Orbit HTTP Server
 *
 * Serves the web UI and provides SSE streaming for transcripts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
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

class OrbitServer {
	private port: number;
	private publicDir: string;
	private clients: Map<string, SSEClient> = new Map();
	private sessionManager = getSessionManager();
	private logger = getLogger();
	private server: ReturnType<typeof Bun.serve> | null = null;
	private clientCounter = 0;

	constructor(port: number) {
		this.port = port;
		// Public dir relative to this file's location
		this.publicDir = join(import.meta.dir, '..', 'public');
	}

	async start(): Promise<void> {
		this.logger.serverStart(this.port);

		// Discover sessions on start
		await this.sessionManager.discover();

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
		// GET /api/sessions - List all sessions
		if (path === '/api/sessions' && req.method === 'GET') {
			const sessions = await this.sessionManager.discover();
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
		const parser = new StreamingParser();
		let lastPosition = 0;
		let pingInterval: ReturnType<typeof setInterval> | null = null;

		const stream = new ReadableStream({
			start: (controller) => {
				// Set up file watcher
				const cleanup = this.sessionManager.watchSession(session.id, async () => {
					try {
						const file = Bun.file(session.path);
						const size = file.size;
						if (size <= lastPosition) return;

						const content = await file.slice(lastPosition).text();
						lastPosition = size;

						const entries = parser.parse(content);
						for (const entry of entries) {
							const data = `data: ${JSON.stringify(entry)}\n\n`;
							controller.enqueue(new TextEncoder().encode(data));
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

						// Send initial entries with pagination info
						const initData = `data: ${JSON.stringify({ type: 'init', entries, cursor, hasMore })}\n\n`;
						controller.enqueue(new TextEncoder().encode(initData));
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
