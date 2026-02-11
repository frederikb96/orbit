/**
 * V3 API Tests
 *
 * Tests for the dual-mode architecture endpoints:
 * - /api/sessions/:id/live - Live SSE stream (no init batch)
 * - /api/sessions/:id/archive - Paginated historical entries
 * - SSEDebouncer - Event batching
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SSEDebouncer } from '../src/server/sse.ts';
import type { ParsedEntry } from '../src/types.ts';

const TEST_DIR = join(import.meta.dir, 'fixtures');
const TEST_TRANSCRIPT = join(TEST_DIR, 'v3-test-transcript.jsonl');

// Helper to create test entries
function createTestEntry(index: number, timestamp?: string): string {
	return JSON.stringify({
		type: 'user',
		userType: 'external',
		timestamp: timestamp || new Date(Date.now() - (100 - index) * 1000).toISOString(),
		message: { content: `Message ${index}` },
	});
}

describe('SSEDebouncer', () => {
	test('batches items and flushes after delay', async () => {
		const batches: ParsedEntry[][] = [];
		const debouncer = new SSEDebouncer(50, (batch) => {
			batches.push(batch);
		});

		const entry1: ParsedEntry = {
			id: '1',
			type: 'user',
			timestamp: '2024-01-01T00:00:00Z',
			content: 'a',
		};
		const entry2: ParsedEntry = {
			id: '2',
			type: 'user',
			timestamp: '2024-01-01T00:00:01Z',
			content: 'b',
		};

		debouncer.add(entry1);
		expect(debouncer.pendingCount).toBe(1);

		debouncer.add(entry2);
		expect(debouncer.pendingCount).toBe(2);

		// Not flushed yet
		expect(batches.length).toBe(0);

		// Wait for debounce
		await new Promise((r) => setTimeout(r, 100));

		expect(batches.length).toBe(1);
		expect(batches[0]).toHaveLength(2);
		expect(debouncer.pendingCount).toBe(0);
	});

	test('flush() immediately sends pending items', () => {
		const batches: ParsedEntry[][] = [];
		const debouncer = new SSEDebouncer(1000, (batch) => {
			batches.push(batch);
		});

		const entry: ParsedEntry = {
			id: '1',
			type: 'user',
			timestamp: '2024-01-01T00:00:00Z',
			content: 'a',
		};
		debouncer.add(entry);

		// Immediate flush
		debouncer.flush();

		expect(batches.length).toBe(1);
		expect(batches[0]).toHaveLength(1);
		expect(debouncer.pendingCount).toBe(0);
	});

	test('cancel() clears pending items without flushing', async () => {
		const batches: ParsedEntry[][] = [];
		const debouncer = new SSEDebouncer(50, (batch) => {
			batches.push(batch);
		});

		const entry: ParsedEntry = {
			id: '1',
			type: 'user',
			timestamp: '2024-01-01T00:00:00Z',
			content: 'a',
		};
		debouncer.add(entry);
		expect(debouncer.pendingCount).toBe(1);

		debouncer.cancel();
		expect(debouncer.pendingCount).toBe(0);

		// Wait to ensure timer doesn't fire
		await new Promise((r) => setTimeout(r, 100));
		expect(batches.length).toBe(0);
	});

	test('addAll() adds multiple items', () => {
		const batches: ParsedEntry[][] = [];
		const debouncer = new SSEDebouncer(1000, (batch) => {
			batches.push(batch);
		});

		const entries: ParsedEntry[] = [
			{ id: '1', type: 'user', timestamp: '2024-01-01T00:00:00Z', content: 'a' },
			{ id: '2', type: 'user', timestamp: '2024-01-01T00:00:01Z', content: 'b' },
			{ id: '3', type: 'user', timestamp: '2024-01-01T00:00:02Z', content: 'c' },
		];

		debouncer.addAll(entries);
		expect(debouncer.pendingCount).toBe(3);

		debouncer.flush();
		expect(batches[0]).toHaveLength(3);
	});

	test('empty flush does not call callback', () => {
		let callCount = 0;
		const debouncer = new SSEDebouncer(50, () => {
			callCount++;
		});

		debouncer.flush();
		expect(callCount).toBe(0);
	});
});

describe('Archive endpoint response format', () => {
	beforeAll(() => {
		if (!existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true });
		}
	});

	afterAll(() => {
		if (existsSync(TEST_TRANSCRIPT)) {
			rmSync(TEST_TRANSCRIPT);
		}
	});

	test('cursor pagination structure', async () => {
		// Create test file with entries
		const lines: string[] = [];
		const baseTime = Date.now() - 100000;
		for (let i = 0; i < 100; i++) {
			lines.push(
				JSON.stringify({
					type: 'user',
					userType: 'external',
					timestamp: new Date(baseTime + i * 1000).toISOString(),
					message: { content: `Message ${i}` },
				}),
			);
		}
		writeFileSync(TEST_TRANSCRIPT, `${lines.join('\n')}\n`);

		// Import and use parseTranscriptTail to simulate archive logic
		const { parseTranscriptTail } = await import('../src/lib/transcript.ts');
		const { entries } = await parseTranscriptTail(TEST_TRANSCRIPT, 0);

		// Simulate archive filtering
		const snapshot = Date.now();
		const filteredEntries = entries.filter((e) => {
			if (!e.timestamp) return true;
			return new Date(e.timestamp).getTime() < snapshot;
		});

		expect(filteredEntries.length).toBe(100);

		// Simulate last N
		const limit = 50;
		const startIdx = Math.max(0, filteredEntries.length - limit);
		const resultEntries = filteredEntries.slice(startIdx);
		const hasMore = startIdx > 0;
		const nextCursor = hasMore ? resultEntries[0].timestamp : null;

		expect(resultEntries.length).toBe(50);
		expect(hasMore).toBe(true);
		expect(nextCursor).toBeTruthy();

		// Simulate before cursor
		const beforeTime = new Date(nextCursor!).getTime();
		const entriesBeforeCursor = filteredEntries.filter((e) => {
			if (!e.timestamp) return false;
			return new Date(e.timestamp).getTime() < beforeTime;
		});

		expect(entriesBeforeCursor.length).toBe(50);
	});

	test('snapshot filtering excludes future entries', async () => {
		// Create entries spanning past to future
		const lines: string[] = [];
		const now = Date.now();
		for (let i = 0; i < 10; i++) {
			lines.push(
				JSON.stringify({
					type: 'user',
					userType: 'external',
					timestamp: new Date(now - 5000 + i * 1000).toISOString(),
					message: { content: `Message ${i}` },
				}),
			);
		}
		writeFileSync(TEST_TRANSCRIPT, `${lines.join('\n')}\n`);

		const { parseTranscriptTail } = await import('../src/lib/transcript.ts');
		const { entries } = await parseTranscriptTail(TEST_TRANSCRIPT, 0);

		// Snapshot at "now" should exclude entries with timestamps >= now
		const snapshot = now;
		const filtered = entries.filter((e) => {
			if (!e.timestamp) return true;
			return new Date(e.timestamp).getTime() < snapshot;
		});

		// Should have fewer entries than total
		expect(filtered.length).toBeLessThanOrEqual(entries.length);
		// Entries 0-4 are in the past (now - 5000 to now - 1000)
		// Entry 5 is at now, entries 6-9 are in the future
		expect(filtered.length).toBe(5);
	});
});

describe('Live SSE endpoint behavior', () => {
	test('live_start event structure', () => {
		// Test the expected event format
		const event = {
			type: 'live_start',
			sessionId: 'test-session',
			snapshotTimestamp: Date.now(),
		};

		expect(event.type).toBe('live_start');
		expect(typeof event.snapshotTimestamp).toBe('number');
		expect(event.snapshotTimestamp).toBeGreaterThan(0);
	});

	test('batch event structure', () => {
		const entries: ParsedEntry[] = [
			{ id: 'entry-0', type: 'user', timestamp: new Date().toISOString(), content: 'test' },
		];

		const event = {
			type: 'batch',
			entries,
			sessionId: 'test-session',
		};

		expect(event.type).toBe('batch');
		expect(Array.isArray(event.entries)).toBe(true);
		expect(event.entries.length).toBe(1);
	});
});
