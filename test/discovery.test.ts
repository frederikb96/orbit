import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getNewestNFiles } from '../src/lib/discovery.ts';

const TEST_DIR = join(import.meta.dir, 'fixtures', 'discovery-test');

describe('getNewestNFiles', () => {
	beforeAll(() => {
		if (!existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true });
		}

		// Create test files with different mtimes (using setTimeout would be flaky)
		writeFileSync(join(TEST_DIR, 'a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6.jsonl'), 'session1');
		writeFileSync(join(TEST_DIR, 'agent-1234567.jsonl'), 'agent1');
		writeFileSync(join(TEST_DIR, 'agent-aprompt_suggestion-abcdef0.jsonl'), 'invalid-agent');
		writeFileSync(join(TEST_DIR, 'config.jsonl'), 'config');
		writeFileSync(join(TEST_DIR, 'test.txt'), 'text file');
	});

	afterAll(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true });
		}
	});

	test('returns empty array for non-existent directory', () => {
		const result = getNewestNFiles('/non/existent/path', 10);
		expect(result).toHaveLength(0);
	});

	test('returns empty array for n <= 0', () => {
		expect(getNewestNFiles(TEST_DIR, 0)).toHaveLength(0);
		expect(getNewestNFiles(TEST_DIR, -1)).toHaveLength(0);
	});

	test('filters by extension', () => {
		const result = getNewestNFiles(TEST_DIR, 100, { extension: '.jsonl' });
		expect(result.every((f) => f.path.endsWith('.jsonl'))).toBe(true);
		expect(result.length).toBe(4);
	});

	test('filters by matchFilename predicate', () => {
		const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
		const agentPattern = /^agent-[a-f0-9]{7,8}\.jsonl$/;

		const isValidSession = (filename: string) =>
			uuidPattern.test(filename) || agentPattern.test(filename);

		const result = getNewestNFiles(TEST_DIR, 100, {
			extension: '.jsonl',
			matchFilename: isValidSession,
		});

		expect(result.length).toBe(2);
		expect(result.some((f) => f.path.includes('a4e92aa8'))).toBe(true);
		expect(result.some((f) => f.path.includes('agent-1234567'))).toBe(true);
		expect(result.some((f) => f.path.includes('aprompt_suggestion'))).toBe(false);
		expect(result.some((f) => f.path.includes('config'))).toBe(false);
	});

	test('limits results to n', () => {
		const result = getNewestNFiles(TEST_DIR, 2, { extension: '.jsonl' });
		expect(result.length).toBe(2);
	});

	test('results are sorted by mtime descending', () => {
		const result = getNewestNFiles(TEST_DIR, 100, { extension: '.jsonl' });
		for (let i = 0; i < result.length - 1; i++) {
			expect(result[i].mtimeMs).toBeGreaterThanOrEqual(result[i + 1].mtimeMs);
		}
	});
});
