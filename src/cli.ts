#!/usr/bin/env bun
/**
 * Orbit CLI
 *
 * Commands:
 * - orbit start [-p PORT] - Start daemon
 * - orbit stop - Stop daemon
 * - orbit status - Check if running
 * - orbit logs [-f] - View logs via journalctl
 * - orbit build - Build client bundle
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { getConfig } from './lib/config.ts';

const STATE_DIR = join(homedir(), '.local', 'state', 'orbit');
const PID_FILE = join(STATE_DIR, 'pid');

function ensureStateDir(): void {
	if (!existsSync(STATE_DIR)) {
		mkdirSync(STATE_DIR, { recursive: true });
	}
}

function readPid(): number | null {
	if (!existsSync(PID_FILE)) return null;
	try {
		const content = readFileSync(PID_FILE, 'utf-8').trim();
		const pid = Number.parseInt(content, 10);
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

function writePid(pid: number): void {
	ensureStateDir();
	writeFileSync(PID_FILE, String(pid));
}

function removePid(): void {
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

async function healthCheck(port: number, attempts = 30, intervalMs = 500): Promise<boolean> {
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(`http://localhost:${port}/api/health`);
			if (res.ok) return true;
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

const program = new Command();

program.name('orbit').description('Claude Code transcript viewer').version('0.1.0');

program
	.command('start')
	.description('Start the Orbit server daemon')
	.option('-p, --port <port>', 'Port to listen on')
	.action(async (options) => {
		const existingPid = readPid();
		if (existingPid && isProcessRunning(existingPid)) {
			console.log(`Orbit is already running (PID: ${existingPid})`);
			process.exit(1);
		}

		const config = getConfig();
		const port = options.port ? Number.parseInt(options.port, 10) : config.server.port;

		// Start server as daemon using setsid for proper detaching + systemd-cat for logging
		const serverPath = join(dirname(import.meta.path), 'server', 'index.ts');

		const proc = Bun.spawn(['setsid', 'systemd-cat', '-t', 'orbit', 'bun', 'run', serverPath], {
			env: {
				...process.env,
				ORBIT_PORT: String(port),
			},
			stdio: ['ignore', 'ignore', 'ignore'],
		});

		// Unref so the parent doesn't wait for the child
		proc.unref();

		// Wait for health check to confirm server is up
		const healthy = await healthCheck(port);
		if (!healthy) {
			console.error('Failed to start Orbit server');
			process.exit(1);
		}

		// Write PID file - use the spawned process PID
		writePid(proc.pid);

		console.log(`Orbit started on http://localhost:${port} (PID: ${proc.pid})`);
		process.exit(0);
	});

program
	.command('stop')
	.description('Stop the Orbit server daemon')
	.action(() => {
		const pid = readPid();
		if (!pid) {
			console.log('Orbit is not running');
			process.exit(0);
		}

		if (!isProcessRunning(pid)) {
			console.log('Orbit is not running (stale PID file)');
			removePid();
			process.exit(0);
		}

		try {
			process.kill(pid, 'SIGTERM');
			removePid();
			console.log(`Orbit stopped (PID: ${pid})`);
		} catch (err) {
			console.error(`Failed to stop Orbit: ${err}`);
			process.exit(1);
		}
	});

program
	.command('status')
	.description('Check if Orbit is running')
	.action(() => {
		const pid = readPid();
		if (!pid) {
			console.log('Orbit is not running');
			process.exit(1);
		}

		if (isProcessRunning(pid)) {
			const config = getConfig();
			console.log(`Orbit is running (PID: ${pid}, port: ${config.server.port})`);
			process.exit(0);
		}

		console.log('Orbit is not running (stale PID file)');
		removePid();
		process.exit(1);
	});

program
	.command('logs')
	.description('View Orbit logs')
	.option('-f, --follow', 'Follow log output')
	.action((options) => {
		const args = ['journalctl', '-t', 'orbit', '--output=cat'];
		if (options.follow) {
			args.push('-f');
		}

		const proc = Bun.spawn(args, {
			stdio: ['inherit', 'inherit', 'inherit'],
		});

		// Wait for the process to exit
		proc.exited.then((code) => {
			process.exit(code ?? 0);
		});
	});

program
	.command('build')
	.description('Build the client bundle')
	.action(async () => {
		const entrypoint = join(dirname(import.meta.path), 'client', 'index.tsx');
		const outdir = join(dirname(import.meta.path), '..', 'public');

		console.log('Building client bundle...');

		const result = await Bun.build({
			entrypoints: [entrypoint],
			outdir,
			minify: true,
			naming: 'bundle.js',
		});

		if (result.success) {
			console.log(`Built: ${outdir}/bundle.js`);
		} else {
			console.error('Build failed:');
			for (const log of result.logs) {
				console.error(log);
			}
			process.exit(1);
		}
	});

program.parse();
