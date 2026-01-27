import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../src/lib/sessions.ts';

describe('SessionManager', () => {
	let testDir: string;
	let manager: SessionManager;

	beforeEach(() => {
		testDir = join(tmpdir(), `orbit-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		manager = new SessionManager();
	});

	afterEach(() => {
		manager.cleanup();
		rmSync(testDir, { recursive: true, force: true });
	});

	test('creates singleton instance', () => {
		expect(manager).toBeInstanceOf(SessionManager);
	});

	test('watchSession returns cleanup function', () => {
		const cleanup = manager.watchSession('test-id', () => {});
		expect(typeof cleanup).toBe('function');
		cleanup();
	});

	test('onUpdate returns cleanup function', () => {
		const cleanup = manager.onUpdate(() => {});
		expect(typeof cleanup).toBe('function');
		cleanup();
	});

	test('cleanup does not throw', () => {
		expect(() => manager.cleanup()).not.toThrow();
	});

	test('getProjectDir extracts directory correctly', () => {
		const session = {
			id: 'test-uuid',
			type: 'session' as const,
			path: '/home/user/.claude/projects/-home-user-myproject/session.jsonl',
			mtime: Date.now(),
			size: 100,
			active: false,
		};
		const projectDir = manager.getProjectDir(session);
		expect(projectDir).toBe('/home/user/myproject');
	});
});
