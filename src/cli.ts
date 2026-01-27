#!/usr/bin/env bun
/**
 * Orbit CLI
 *
 * Commands:
 *   orbit start [-p PORT]   Start daemon on port (default 3000)
 *   orbit stop              Stop running daemon
 *   orbit status            Show if running, port, PID
 *   orbit logs [-f] [-n N]  View logs
 *   orbit build             Build client bundle
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import pkg from '../package.json';
import { OrbitServer } from './server.ts';
import type { ServerState } from './types/index.ts';

const VERSION = pkg.version;
const PID_FILE = process.env.XDG_RUNTIME_DIR
	? join(process.env.XDG_RUNTIME_DIR, 'orbit.pid')
	: '/tmp/orbit.pid';

const program = new Command();

program.name('orbit').description('Web-based Claude Code transcript viewer').version(VERSION);

// Start command
program
	.command('start')
	.description('Start the Orbit server')
	.option('-p, --port <port>', 'Port to listen on', '3000')
	.option('-f, --foreground', 'Run in foreground (no daemon)')
	.action(async (options) => {
		const port = Number.parseInt(options.port, 10);

		// Check if already running
		const existing = getServerState();
		if (existing && isProcessRunning(existing.pid)) {
			console.log(`Orbit is already running on port ${existing.port} (PID: ${existing.pid})`);
			process.exit(1);
		}

		if (options.foreground) {
			// Run in foreground
			await runServer(port);
		} else {
			// Daemon mode - spawn detached process
			console.log(`Starting Orbit daemon on port ${port}...`);

			const child = spawn('bun', [import.meta.path, 'start', '-p', String(port), '-f'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				env: { ...process.env },
			});

			child.unref();

			// Poll health endpoint until server is ready (up to 15s - discovery can take ~8s)
			let serverReady = false;
			for (let attempt = 0; attempt < 30; attempt++) {
				await Bun.sleep(500);
				try {
					const res = await fetch(`http://localhost:${port}/api/health`);
					if (res.ok) {
						serverReady = true;
						break;
					}
				} catch {
					// Server not ready yet
				}
			}

			if (serverReady) {
				const state = getServerState();
				console.log(`Orbit started on http://localhost:${port} (PID: ${state?.pid || 'unknown'})`);
				console.log('View logs: orbit logs -f');
			} else {
				console.error('Failed to start Orbit - health check timeout. Check logs: orbit logs');
				process.exit(1);
			}
		}
	});

// Stop command
program
	.command('stop')
	.description('Stop the Orbit server')
	.action(() => {
		const state = getServerState();
		if (!state) {
			console.log('Orbit is not running');
			process.exit(0);
		}

		if (!isProcessRunning(state.pid)) {
			console.log('Orbit is not running (stale PID file)');
			cleanupPidFile();
			process.exit(0);
		}

		console.log(`Stopping Orbit (PID: ${state.pid})...`);
		try {
			process.kill(state.pid, 'SIGTERM');
			cleanupPidFile();
			console.log('Orbit stopped');
		} catch (err) {
			console.error('Failed to stop Orbit:', err);
			process.exit(1);
		}
	});

// Status command
program
	.command('status')
	.description('Show Orbit server status')
	.action(() => {
		const state = getServerState();
		if (!state) {
			console.log('Orbit is not running');
			process.exit(0);
		}

		if (!isProcessRunning(state.pid)) {
			console.log('Orbit is not running (stale PID file)');
			cleanupPidFile();
			process.exit(0);
		}

		console.log('Orbit is running');
		console.log(`  URL:     http://localhost:${state.port}`);
		console.log(`  PID:     ${state.pid}`);
		console.log(`  Started: ${state.startedAt}`);
	});

// Logs command
program
	.command('logs')
	.description('View Orbit logs')
	.option('-f, --follow', 'Follow log output')
	.option('-n, --lines <n>', 'Number of lines to show', '50')
	.action((options) => {
		const args = ['-t', 'orbit', '--output=cat'];

		if (options.follow) {
			args.push('-f');
		} else {
			args.push('-n', options.lines);
		}

		const result = spawnSync('journalctl', args, {
			stdio: 'inherit',
		});

		process.exit(result.status || 0);
	});

// Build command
program
	.command('build')
	.description('Build client bundle')
	.action(async () => {
		const srcPath = join(import.meta.dir, 'client', 'index.tsx');
		const outPath = join(import.meta.dir, '..', 'public', 'bundle.js');

		console.log('Building client bundle...');

		const result = await Bun.build({
			entrypoints: [srcPath],
			outdir: join(import.meta.dir, '..', 'public'),
			naming: 'bundle.js',
			minify: true,
			target: 'browser',
		});

		if (!result.success) {
			console.error('Build failed:');
			for (const log of result.logs) {
				console.error(log);
			}
			process.exit(1);
		}

		console.log(`Built: ${outPath}`);
	});

// Helper functions
function getServerState(): ServerState | null {
	if (!existsSync(PID_FILE)) {
		return null;
	}

	try {
		const content = readFileSync(PID_FILE, 'utf-8');
		return JSON.parse(content);
	} catch (err) {
		// PID file corrupted or unreadable - treat as no server running
		console.error('Warning: Could not read PID file:', err instanceof Error ? err.message : err);
		return null;
	}
}

function saveServerState(state: ServerState): void {
	writeFileSync(PID_FILE, JSON.stringify(state), { mode: 0o600 });
}

function cleanupPidFile(): void {
	if (existsSync(PID_FILE)) {
		unlinkSync(PID_FILE);
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function runServer(port: number): Promise<void> {
	const server = new OrbitServer(port);

	// Save PID file
	saveServerState({
		pid: process.pid,
		port,
		startedAt: new Date().toISOString(),
	});

	// Handle shutdown signals
	const shutdown = () => {
		console.log('\nShutting down...');
		server.stop();
		cleanupPidFile();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	// Start server
	await server.start();

	// Keep process alive
	await new Promise(() => {}); // Never resolves
}

program.parse();
