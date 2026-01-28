/**
 * Orbit HTTP Server
 *
 * Bun.serve() based HTTP server for the Orbit web UI.
 * Serves static files and provides REST API for session/transcript data.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getConfig } from '../lib/config.ts';
import { getSessionManager } from '../lib/sessions.ts';
import { parseTranscriptTail } from '../lib/transcript.ts';
import type { OrbitConfig } from '../types.ts';
import { createSSEHandler } from './sse.ts';

// Session ID validation patterns (same as sessions.ts)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_ID_REGEX = /^[a-f0-9]{7}$/;

function isValidSessionId(id: string): boolean {
	return UUID_REGEX.test(id) || AGENT_ID_REGEX.test(id);
}

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
};

export class OrbitServer {
	private config: OrbitConfig;
	private publicDir: string;
	private server: ReturnType<typeof Bun.serve> | null = null;
	private sessionManager = getSessionManager();
	private sseHandler = createSSEHandler();

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
		this.sessionManager.startWatcher();

		// Support ORBIT_PORT env var for CLI
		const port = process.env.ORBIT_PORT
			? Number.parseInt(process.env.ORBIT_PORT, 10)
			: this.config.server.port;

		this.server = Bun.serve({
			hostname: 'localhost',
			port,
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

		console.log(`Orbit server running at http://localhost:${port}`);
	}

	/**
	 * Stop the server.
	 */
	stop(): void {
		this.sseHandler.closeAll();
		this.sessionManager.stopWatcher();
		this.server?.stop();
		this.server = null;
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

		// GET /api/sessions/:id/stream - SSE stream
		const streamMatch = path.match(/^\/api\/sessions\/([^/]+)\/stream$/);
		if (streamMatch && req.method === 'GET') {
			const id = streamMatch[1];
			const session = this.sessionManager.getSession(id);
			if (!session) {
				return Response.json({ error: 'Session not found' }, { status: 404 });
			}

			return this.sseHandler.createStream(session, this.config);
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
