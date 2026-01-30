/**
 * SSE (Server-Sent Events) Handler
 *
 * Provides real-time transcript streaming to connected clients.
 * Watches session files and pushes new entries as they appear.
 */

import type { FSWatcher } from 'node:fs';
import { StreamingParser, parseTranscriptTail } from '../lib/transcript.ts';
import { createFileWatcher } from '../lib/watcher.ts';
import type { OrbitConfig, Session } from '../types.ts';

interface SSEClient {
	id: string;
	sessionId: string;
	controller: ReadableStreamDefaultController;
	watcher: FSWatcher | null;
	pingInterval: ReturnType<typeof setInterval> | null;
}

const KEEP_ALIVE_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 100;

export class SSEHandler {
	private clients: Map<string, SSEClient> = new Map();
	private clientCounter = 0;
	private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	/**
	 * Create an SSE stream for a session.
	 */
	createStream(session: Session, config: OrbitConfig): Response {
		const clientId = `client-${++this.clientCounter}`;
		const encoder = new TextEncoder();
		let lastPosition = 0;
		let isInitialized = false;
		const parser = new StreamingParser(0);

		const stream = new ReadableStream({
			start: (controller) => {
				let watcher: FSWatcher | null = null;
				let pingInterval: ReturnType<typeof setInterval> | null = null;

				// File change handler with debouncing
				const handleFileChange = async () => {
					if (!isInitialized) return;

					try {
						const file = Bun.file(session.path);
						const size = file.size;

						// Handle file truncation
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
								return;
							}
						}

						if (size <= lastPosition) return;

						const content = await file.slice(lastPosition).text();
						lastPosition = size;

						const entries = parser.parse(content);
						if (entries.length === 0) return;

						try {
							const batchData = `data: ${JSON.stringify({ type: 'batch', entries, sessionId: session.id })}\n\n`;
							controller.enqueue(encoder.encode(batchData));
						} catch {
							// Client disconnected
						}
					} catch (err) {
						console.error(`SSE file read error for ${session.id}:`, err);
					}
				};

				// Debounced file change handler
				const debouncedHandleFileChange = () => {
					const existingTimer = this.debounceTimers.get(clientId);
					if (existingTimer) {
						clearTimeout(existingTimer);
					}
					const timer = setTimeout(() => {
						this.debounceTimers.delete(clientId);
						handleFileChange();
					}, DEBOUNCE_MS);
					this.debounceTimers.set(clientId, timer);
				};

				// Start file watcher
				try {
					watcher = createFileWatcher(session.path, debouncedHandleFileChange);
				} catch (err) {
					console.error(`SSE file watcher failed for ${session.id}:`, err);
				}

				// Store client
				this.clients.set(clientId, {
					id: clientId,
					sessionId: session.id,
					controller,
					watcher,
					pingInterval: null,
				});

				// Send initial entries
				(async () => {
					try {
						const file = Bun.file(session.path);
						lastPosition = file.size;
						const { entries, cursor, hasMore } = await parseTranscriptTail(
							session.path,
							config.transcript.initialLines,
						);

						parser.setByteOffset(lastPosition);

						const initData = `data: ${JSON.stringify({ type: 'init', entries, cursor, hasMore, sessionId: session.id })}\n\n`;
						controller.enqueue(encoder.encode(initData));

						isInitialized = true;

						// Check for any changes during init
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
						console.error(`SSE initial read failed for ${session.id}:`, err);
					}
				})();

				// Keep-alive ping
				pingInterval = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(': ping\n\n'));
					} catch {
						if (pingInterval) clearInterval(pingInterval);
					}
				}, KEEP_ALIVE_INTERVAL_MS);

				// Update client with ping interval (handle race with early disconnect)
				const client = this.clients.get(clientId);
				if (client) {
					client.pingInterval = pingInterval;
				} else {
					clearInterval(pingInterval);
				}
			},
			cancel: () => {
				this.cleanupClient(clientId);
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
	 * Close all SSE connections.
	 */
	closeAll(): void {
		for (const clientId of this.clients.keys()) {
			this.cleanupClient(clientId);
		}
	}

	/**
	 * Cleanup a client connection.
	 */
	private cleanupClient(clientId: string): void {
		// Clear debounce timer
		const timer = this.debounceTimers.get(clientId);
		if (timer) {
			clearTimeout(timer);
			this.debounceTimers.delete(clientId);
		}

		const client = this.clients.get(clientId);
		if (!client) return;

		// Clear ping interval
		if (client.pingInterval) {
			clearInterval(client.pingInterval);
		}

		// Close file watcher
		if (client.watcher) {
			client.watcher.close();
		}

		// Close controller
		try {
			client.controller.close();
		} catch {
			// Already closed
		}

		this.clients.delete(clientId);
	}
}

/**
 * Create an SSE handler instance.
 */
export function createSSEHandler(): SSEHandler {
	return new SSEHandler();
}
