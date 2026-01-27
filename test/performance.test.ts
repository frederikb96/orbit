import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StreamingParser, parseTranscript, parseTranscriptTail } from '../src/lib/transcript.ts';

// Test files for performance testing
const LARGE_TEST_FILE = join(import.meta.dir, 'large-transcript.jsonl');
const MEDIUM_TEST_FILE = join(import.meta.dir, 'medium-transcript.jsonl');

function generateEntry(index: number, type: 'user' | 'assistant'): string {
	if (type === 'user') {
		return JSON.stringify({
			type: 'user',
			userType: 'external',
			timestamp: new Date(Date.now() - (1000 - index) * 1000).toISOString(),
			message: {
				content: `User message ${index} with some additional content to make it realistic`,
			},
		});
	}
	return JSON.stringify({
		type: 'assistant',
		timestamp: new Date(Date.now() - (1000 - index) * 1000 + 500).toISOString(),
		message: {
			content: [
				{ type: 'thinking', thinking: `Thinking about message ${index}...`.repeat(10) },
				{ type: 'text', text: `Response to message ${index}` },
				{
					type: 'tool_use',
					id: `tool-${index}`,
					name: 'Read',
					input: { file_path: `/tmp/test-${index}.txt` },
				},
			],
			usage: { input_tokens: 1000 + index, output_tokens: 500 + index },
		},
	});
}

describe('Performance Tests', () => {
	beforeAll(() => {
		// Generate large test file (~1000 entries, ~5MB)
		const largeLines: string[] = [];
		for (let i = 0; i < 1000; i++) {
			largeLines.push(generateEntry(i, 'user'));
			largeLines.push(generateEntry(i, 'assistant'));
		}
		writeFileSync(LARGE_TEST_FILE, `${largeLines.join('\n')}\n`);

		// Generate medium test file (~200 entries)
		const mediumLines: string[] = [];
		for (let i = 0; i < 200; i++) {
			mediumLines.push(generateEntry(i, 'user'));
			mediumLines.push(generateEntry(i, 'assistant'));
		}
		writeFileSync(MEDIUM_TEST_FILE, `${mediumLines.join('\n')}\n`);
	});

	afterAll(() => {
		if (existsSync(LARGE_TEST_FILE)) rmSync(LARGE_TEST_FILE);
		if (existsSync(MEDIUM_TEST_FILE)) rmSync(MEDIUM_TEST_FILE);
	});

	describe('parseTranscriptTail', () => {
		test('loads tail of large file efficiently', async () => {
			const start = performance.now();
			const result = await parseTranscriptTail(LARGE_TEST_FILE, 100);
			const duration = performance.now() - start;

			// Should complete quickly (under 100ms)
			expect(duration).toBeLessThan(100);
			expect(result.entries.length).toBeLessThanOrEqual(100);
			expect(result.hasMore).toBe(true);
		});

		test('entries have unique stable IDs based on byte offset', async () => {
			const result1 = await parseTranscriptTail(MEDIUM_TEST_FILE, 50);
			const result2 = await parseTranscriptTail(MEDIUM_TEST_FILE, 50);

			// Same load should produce same IDs
			expect(result1.entries.map((e) => e.id)).toEqual(result2.entries.map((e) => e.id));

			// IDs should be unique
			const ids = new Set(result1.entries.map((e) => e.id));
			expect(ids.size).toBe(result1.entries.length);

			// IDs should be byte-offset based
			for (const entry of result1.entries) {
				expect(entry.id).toMatch(/^entry-\d+$/);
			}
		});

		test('pagination loads older entries with non-overlapping IDs', async () => {
			// Load newest 50
			const first = await parseTranscriptTail(MEDIUM_TEST_FILE, 50);
			expect(first.entries.length).toBeGreaterThan(0);
			expect(first.hasMore).toBe(true);

			// Load next 50 using cursor
			const second = await parseTranscriptTail(MEDIUM_TEST_FILE, 50, first.cursor);
			expect(second.entries.length).toBeGreaterThan(0);

			// IDs should not overlap
			const firstIds = new Set(first.entries.map((e) => e.id));
			const secondIds = new Set(second.entries.map((e) => e.id));
			for (const id of secondIds) {
				expect(firstIds.has(id)).toBe(false);
			}

			// Second batch should have earlier entries (smaller byte offsets)
			const firstMinOffset = Math.min(
				...first.entries.map((e) => Number.parseInt(e.id.split('-')[1])),
			);
			const secondMaxOffset = Math.max(
				...second.entries.map((e) => Number.parseInt(e.id.split('-')[1])),
			);
			expect(secondMaxOffset).toBeLessThan(firstMinOffset);
		});

		test('can paginate through entire file', async () => {
			const allEntries: string[] = [];
			let cursor: number | undefined;
			let iterations = 0;
			const maxIterations = 20; // Safety limit

			do {
				const result = await parseTranscriptTail(MEDIUM_TEST_FILE, 50, cursor);
				for (const entry of result.entries) {
					allEntries.push(entry.id);
				}
				cursor = result.cursor;
				iterations++;

				if (!result.hasMore) break;
			} while (cursor > 0 && iterations < maxIterations);

			// Should have loaded all entries
			const uniqueIds = new Set(allEntries);
			expect(uniqueIds.size).toBe(allEntries.length);

			// Should have at least most of the entries (400 in medium file)
			expect(allEntries.length).toBeGreaterThan(300);
		});
	});

	describe('StreamingParser', () => {
		test('generates stable IDs with byte offset tracking', () => {
			const parser = new StreamingParser(1000);
			const content = `${JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Hi' } })}\n`;

			const entries = parser.parse(content);
			expect(entries).toHaveLength(1);
			expect(entries[0].id).toBe('entry-1000');
		});

		test('tracks byte offset across multiple parses', () => {
			const parser = new StreamingParser(0);

			const line1 = JSON.stringify({
				type: 'user',
				userType: 'external',
				message: { content: 'First' },
			});
			const line2 = JSON.stringify({
				type: 'user',
				userType: 'external',
				message: { content: 'Second' },
			});

			const entries1 = parser.parse(`${line1}\n`);
			const entries2 = parser.parse(`${line2}\n`);

			expect(entries1[0].id).toBe('entry-0');
			// Second entry should have offset = length of first line + newline
			const expectedOffset = Buffer.byteLength(line1, 'utf8') + 1;
			expect(entries2[0].id).toBe(`entry-${expectedOffset}`);
		});

		test('setByteOffset updates position correctly', () => {
			const parser = new StreamingParser(0);
			parser.setByteOffset(5000);

			const content = `${JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Test' } })}\n`;
			const entries = parser.parse(content);

			expect(entries[0].id).toBe('entry-5000');
		});
	});

	describe('parseTranscript (full parse)', () => {
		test('generates stable byte-offset IDs', () => {
			const lines = [
				JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Hello' } }),
				JSON.stringify({
					type: 'assistant',
					message: { content: [{ type: 'text', text: 'Hi!' }] },
				}),
			];
			const content = `${lines.join('\n')}\n`;

			const { entries } = parseTranscript(content);
			expect(entries).toHaveLength(2);

			// First entry at offset 0
			expect(entries[0].id).toBe('entry-0');

			// Second entry at offset = length of first line + newline
			const expectedOffset = Buffer.byteLength(lines[0], 'utf8') + 1;
			expect(entries[1].id).toBe(`entry-${expectedOffset}`);
		});
	});
});
