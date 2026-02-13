/**
 * SSE (Server-Sent Events) Handler
 *
 * Provides real-time transcript streaming to connected clients.
 * Watches session files and pushes new entries as they appear.
 */

import { StreamingParser, parseTranscriptTail } from '../lib/transcript.ts';
import { type FileWatcher, createFileWatcher } from '../lib/watcher.ts';
import type { OrbitConfig, ParsedEntry, Session } from '../types.ts';

/**
 * Debounces SSE events into batches.
 * Accumulates items and flushes after a delay, reducing network overhead.
 */
export class SSEDebouncer {
	private pending: ParsedEntry[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private delayMs: number;
	private flushCallback: (batch: ParsedEntry[]) => void;

	constructor(delayMs: number, callback: (batch: ParsedEntry[]) => void) {
		this.delayMs = delayMs;
		this.flushCallback = callback;
	}

	/**
	 * Add an item to the pending batch.
	 * Starts the flush timer if not already running.
	 */
	add(item: ParsedEntry): void {
		this.pending.push(item);
		if (!this.timer) {
			this.timer = setTimeout(() => this.flush(), this.delayMs);
		}
	}

	/**
	 * Add multiple items to the pending batch.
	 */
	addAll(items: ParsedEntry[]): void {
		for (const item of items) {
			this.add(item);
		}
	}

	/**
	 * Immediately flush pending items.
	 */
	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const batch = this.pending;
		this.pending = [];
		if (batch.length > 0) {
			this.flushCallback(batch);
		}
	}

	/**
	 * Cancel pending flush and clear items.
	 */
	cancel(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.pending = [];
	}

	/**
	 * Get count of pending items.
	 */
	get pendingCount(): number {
		return this.pending.length;
	}
}

interface SSEClient {
	id: string;
	sessionId: string;
	controller: ReadableStreamDefaultController;
	watcher: FileWatcher | null;
	pingInterval: ReturnType<typeof setInterval> | null;
}

// Keepalive ping interval - 15 seconds prevents browser/proxy timeouts
const KEEP_ALIVE_INTERVAL_MS = 15_000;
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

				// Store client (watcher set async below)
				this.clients.set(clientId, {
					id: clientId,
					sessionId: session.id,
					controller,
					watcher: null,
					pingInterval: null,
				});

				// Start watcher + send initial entries (sequential async)
				(async () => {
					// Start watcher first so file changes during init are caught
					try {
						const w = await createFileWatcher(session.path, debouncedHandleFileChange);
						const client = this.clients.get(clientId);
						if (client) {
							client.watcher = w;
						} else {
							w.close();
							return;
						}
					} catch (err) {
						console.error(`SSE file watcher failed for ${session.id}:`, err);
					}

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
	 * Create a live SSE stream for a session (V3 mode).
	 * Does NOT send history on connect - only streams new entries.
	 *
	 * @param session - Session to stream
	 * @param debounceMs - Debounce delay in ms (default 500)
	 * @returns Response with SSE stream
	 */
	createLiveStream(session: Session, debounceMs = 500): Response {
		const clientId = `live-${++this.clientCounter}`;
		const encoder = new TextEncoder();
		const parser = new StreamingParser(0);
		let lastPosition = 0;

		const stream = new ReadableStream({
			start: (controller) => {
				let pingInterval: ReturnType<typeof setInterval> | null = null;

				// Debouncer for batching new entries
				const debouncer = new SSEDebouncer(debounceMs, (batch) => {
					try {
						const batchData = `data: ${JSON.stringify({ type: 'batch', entries: batch, sessionId: session.id })}\n\n`;
						controller.enqueue(encoder.encode(batchData));
					} catch {
						// Client disconnected
					}
				});

				// File change handler
				const handleFileChange = async () => {
					try {
						const file = Bun.file(session.path);
						const size = file.size;

						// Handle file truncation
						if (size < lastPosition) {
							lastPosition = 0;
							parser.setByteOffset(0);
							debouncer.flush();
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
						if (entries.length > 0) {
							debouncer.addAll(entries);
						}
					} catch (err) {
						console.error(`Live SSE file read error for ${session.id}:`, err);
					}
				};

				// Debounced file change handler (100ms for file events, then 500ms for SSE batching)
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

				// Store client (watcher set async below)
				this.clients.set(clientId, {
					id: clientId,
					sessionId: session.id,
					controller,
					watcher: null,
					pingInterval: null,
				});

				// Init position + start watcher (sequential async)
				(async () => {
					// Set position BEFORE watcher starts (prevents reading entire file on first event)
					try {
						const file = Bun.file(session.path);
						lastPosition = file.size;
						parser.setByteOffset(lastPosition);

						const snapshotTimestamp = Date.now();
						const initData = `data: ${JSON.stringify({
							type: 'live_start',
							sessionId: session.id,
							snapshotTimestamp,
						})}\n\n`;
						controller.enqueue(encoder.encode(initData));
					} catch (err) {
						console.error(`Live SSE init failed for ${session.id}:`, err);
					}

					// Start watcher AFTER position is set
					try {
						const w = await createFileWatcher(session.path, debouncedHandleFileChange);
						const client = this.clients.get(clientId);
						if (client) {
							client.watcher = w;
						} else {
							w.close();
						}
					} catch (err) {
						console.error(`Live SSE file watcher failed for ${session.id}:`, err);
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
