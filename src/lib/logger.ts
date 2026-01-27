/**
 * JSON Logger with systemd-cat integration
 *
 * Logs are written to journald via systemd-cat in NDJSON format.
 * Gracefully degrades if systemd-cat is not available.
 *
 * View logs: journalctl -t orbit --output=cat [-f]
 */

import { spawn } from 'node:child_process';
import type { LogEntry, LogLevel } from '../types/index.ts';

const IDENTIFIER = 'orbit';

class JsonLogger {
	private identifier: string;

	constructor(identifier: string = IDENTIFIER) {
		this.identifier = identifier;
	}

	private log(level: LogLevel, op: string, data: Record<string, unknown> = {}): void {
		const entry: LogEntry = {
			ts: new Date().toISOString(),
			lvl: level,
			op,
			...data,
		};

		const jsonLine = JSON.stringify(entry);

		// Also write to stderr for immediate feedback during development
		if (process.env.ORBIT_DEBUG) {
			console.error(`[${level.toUpperCase()}] ${op}:`, JSON.stringify(data));
		}

		try {
			const proc = spawn(
				'systemd-cat',
				['-t', this.identifier, '-p', this.levelToPriority(level)],
				{
					stdio: ['pipe', 'inherit', 'inherit'],
				},
			);
			proc.stdin?.write(`${jsonLine}\n`);
			proc.stdin?.end();
		} catch {
			// Silently fail if systemd-cat not available
		}
	}

	private levelToPriority(level: LogLevel): string {
		switch (level) {
			case 'debug':
				return 'debug';
			case 'info':
				return 'info';
			case 'warn':
				return 'warning';
			case 'error':
				return 'err';
		}
	}

	debug(op: string, data: Record<string, unknown> = {}): void {
		this.log('debug', op, data);
	}

	info(op: string, data: Record<string, unknown> = {}): void {
		this.log('info', op, data);
	}

	warn(op: string, data: Record<string, unknown> = {}): void {
		this.log('warn', op, data);
	}

	error(op: string, data: Record<string, unknown> = {}): void {
		this.log('error', op, data);
	}

	// Server lifecycle events
	serverStart(port: number): void {
		this.info('server_start', { port, pid: process.pid });
	}

	serverStop(reason: string): void {
		this.info('server_stop', { reason, pid: process.pid });
	}

	// Request logging
	request(method: string, path: string, statusCode: number, durationMs: number): void {
		this.info('request', { method, path, status: statusCode, duration_ms: durationMs });
	}

	// SSE events
	sseConnect(sessionId: string, clientId: string): void {
		this.debug('sse_connect', { session_id: sessionId, client_id: clientId });
	}

	sseDisconnect(sessionId: string, clientId: string): void {
		this.debug('sse_disconnect', { session_id: sessionId, client_id: clientId });
	}

	// Session events
	sessionDiscovered(sessionId: string, type: string, path: string): void {
		this.debug('session_discovered', { session_id: sessionId, type, path });
	}

	sessionUpdate(sessionId: string, entriesAdded: number): void {
		this.debug('session_update', { session_id: sessionId, entries_added: entriesAdded });
	}

	// Error events
	errorOccurred(op: string, message: string, details?: Record<string, unknown>): void {
		this.error(op, { message, ...details });
	}
}

// Singleton instance
let loggerInstance: JsonLogger | null = null;

export function getLogger(): JsonLogger {
	if (!loggerInstance) {
		loggerInstance = new JsonLogger();
	}
	return loggerInstance;
}

export { JsonLogger };
