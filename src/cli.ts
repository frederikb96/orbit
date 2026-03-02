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

import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { getConfig } from './lib/config.ts';
import { readPid, removePid } from './shared/state.ts';

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function isSystemdActive(): Promise<boolean> {
	try {
		const proc = Bun.spawn(['systemctl', '--user', 'is-active', 'orbit.service'], {
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		return output.trim() === 'active';
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

const pkg = await Bun.file(join(dirname(import.meta.path), '..', 'package.json')).json();
program.name('orbit').description('Claude Code transcript viewer').version(pkg.version);

program
	.command('start')
	.description('Start the Orbit server daemon')
	.option('-p, --port <port>', 'Port to listen on')
	.option('--foreground', 'Run in foreground (for systemd)')
	.action(async (options) => {
		const existingPid = readPid();
		if (existingPid && isProcessRunning(existingPid)) {
			console.log(`Orbit is already running (PID: ${existingPid})`);
			process.exit(1);
		}

		const config = getConfig();
		const port = options.port ? Number.parseInt(options.port, 10) : config.server.port;

		if (options.foreground) {
			process.env.ORBIT_PORT = String(port);
			const { startServer } = await import('./server/index.ts');
			const server = await startServer();

			const shutdown = async () => {
				await server.stop();
				process.exit(0);
			};
			process.on('SIGTERM', shutdown);
			process.on('SIGINT', shutdown);
			return;
		}

		// Daemon mode: spawn detached process with journald logging
		const serverPath = join(dirname(import.meta.path), 'server', 'index.ts');

		const proc = Bun.spawn(['setsid', 'systemd-cat', '-t', 'orbit', 'bun', 'run', serverPath], {
			env: {
				...process.env,
				ORBIT_PORT: String(port),
			},
			stdio: ['ignore', 'ignore', 'ignore'],
		});

		proc.unref();

		const healthy = await healthCheck(port);
		if (!healthy) {
			console.error('Failed to start Orbit server');
			process.exit(1);
		}

		const serverPid = readPid();
		console.log(
			`Orbit started on http://localhost:${port}${serverPid ? ` (PID: ${serverPid})` : ''}`,
		);
		process.exit(0);
	});

program
	.command('stop')
	.description('Stop the Orbit server daemon')
	.action(async () => {
		if (await isSystemdActive()) {
			console.log('Orbit is managed by systemd. Use: systemctl --user stop orbit');
			process.exit(1);
		}

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
	.action(async () => {
		const pid = readPid();
		const systemd = await isSystemdActive();

		if (!pid) {
			if (systemd) {
				console.log('Orbit is running via systemd');
				process.exit(0);
			}
			console.log('Orbit is not running');
			process.exit(1);
		}

		if (isProcessRunning(pid)) {
			const config = getConfig();
			const mode = systemd ? 'systemd' : 'daemon';
			console.log(`Orbit is running (PID: ${pid}, port: ${config.server.port}, ${mode})`);
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
	.action(async (options) => {
		const systemd = await isSystemdActive();
		const args = systemd
			? ['journalctl', '--user', '-u', 'orbit.service', '--output=cat']
			: ['journalctl', '-t', 'orbit', '--output=cat'];
		if (options.follow) {
			args.push('-f');
		}

		const proc = Bun.spawn(args, {
			stdio: ['inherit', 'inherit', 'inherit'],
		});

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
