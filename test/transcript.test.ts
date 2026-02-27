import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	StreamingParser,
	parseEntry,
	parseTranscript,
	parseTranscriptTail,
	updateTokens,
} from '../src/lib/transcript.ts';
import { formatNumber, formatTime, formatToolInput } from '../src/shared/formatters.ts';
import type { TokenStats } from '../src/types.ts';

const TEST_DIR = join(import.meta.dir, 'fixtures');
const TEST_FILE = join(TEST_DIR, 'test-transcript.jsonl');

describe('parseEntry', () => {
	const toolMap = new Map<string, string>();

	test('returns null for empty line', () => {
		expect(parseEntry('', toolMap)).toBeNull();
		expect(parseEntry('   ', toolMap)).toBeNull();
	});

	test('returns null for invalid JSON', () => {
		expect(parseEntry('not json', toolMap)).toBeNull();
		expect(parseEntry('{invalid}', toolMap)).toBeNull();
	});

	test('parses user entry', () => {
		const line = JSON.stringify({
			type: 'user',
			userType: 'external',
			timestamp: '2024-01-15T10:30:00Z',
			message: { content: 'Hello, world!' },
		});

		const entry = parseEntry(line, toolMap);
		expect(entry).not.toBeNull();
		expect(entry?.type).toBe('user');
		expect(entry?.content).toBe('Hello, world!');
	});

	test('parses assistant entry with text', () => {
		const line = JSON.stringify({
			type: 'assistant',
			timestamp: '2024-01-15T10:30:01Z',
			message: {
				content: [{ type: 'text', text: 'Hello!' }],
				usage: { input_tokens: 100, output_tokens: 50 },
			},
		});

		const entry = parseEntry(line, toolMap);
		expect(entry).not.toBeNull();
		expect(entry?.type).toBe('assistant');
		expect(entry?.content).toBe('Hello!');
		expect(entry?.tokens?.input_tokens).toBe(100);
	});

	test('parses assistant entry with tool call', () => {
		const line = JSON.stringify({
			type: 'assistant',
			timestamp: '2024-01-15T10:30:01Z',
			message: {
				content: [
					{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/test.txt' } },
				],
			},
		});

		const entry = parseEntry(line, toolMap);
		expect(entry).not.toBeNull();
		expect(entry?.toolCalls).toHaveLength(1);
		expect(entry?.toolCalls?.[0].name).toBe('Read');
		expect(toolMap.get('tool-1')).toBe('Read');
	});

	test('parses tool result entry', () => {
		toolMap.set('tool-1', 'Read');

		const line = JSON.stringify({
			type: 'user',
			userType: 'external',
			timestamp: '2024-01-15T10:30:02Z',
			message: {
				content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
			},
		});

		const entry = parseEntry(line, toolMap);
		expect(entry).not.toBeNull();
		expect(entry?.type).toBe('tool_result');
		expect(entry?.toolResult?.toolName).toBe('Read');
		expect(entry?.toolResult?.content).toBe('file contents');
	});

	test('parses thinking block', () => {
		const line = JSON.stringify({
			type: 'assistant',
			timestamp: '2024-01-15T10:30:01Z',
			message: {
				content: [
					{ type: 'thinking', thinking: 'Let me think...' },
					{ type: 'text', text: 'Here is my response' },
				],
			},
		});

		const entry = parseEntry(line, toolMap);
		expect(entry?.thinking).toBe('Let me think...');
		expect(entry?.content).toBe('Here is my response');
	});
});

describe('parseTranscript', () => {
	test('parses multiple entries', () => {
		const content = [
			JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Hi' } }),
			JSON.stringify({
				type: 'assistant',
				message: { content: [{ type: 'text', text: 'Hello!' }], usage: { input_tokens: 50 } },
			}),
		].join('\n');

		const { entries, tokens } = parseTranscript(content);
		expect(entries).toHaveLength(2);
		expect(tokens.turns).toBe(1);
		expect(tokens.totalInputTokens).toBe(50);
	});

	test('handles empty content', () => {
		const { entries, tokens } = parseTranscript('');
		expect(entries).toHaveLength(0);
		expect(tokens.turns).toBe(0);
	});
});

describe('updateTokens', () => {
	test('accumulates token counts', () => {
		const stats: TokenStats = {
			totalInputTokens: 100,
			totalOutputTokens: 50,
			totalCacheCreationTokens: 0,
			totalCacheReadTokens: 0,
			turns: 1,
			currentContextTokens: 100,
		};

		updateTokens(stats, { input_tokens: 200, output_tokens: 100 });

		expect(stats.totalInputTokens).toBe(300);
		expect(stats.totalOutputTokens).toBe(150);
		expect(stats.currentContextTokens).toBe(200);
	});

	test('handles undefined values', () => {
		const stats: TokenStats = {
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCacheCreationTokens: 0,
			totalCacheReadTokens: 0,
			turns: 0,
			currentContextTokens: 0,
		};

		updateTokens(stats, {});
		expect(stats.totalInputTokens).toBe(0);
	});
});

describe('formatNumber', () => {
	test('formats small numbers', () => {
		expect(formatNumber(0)).toBe('0');
		expect(formatNumber(100)).toBe('100');
		expect(formatNumber(999)).toBe('999');
	});

	test('formats thousands', () => {
		expect(formatNumber(1000)).toBe('1.0k');
		expect(formatNumber(1500)).toBe('1.5k');
		expect(formatNumber(10000)).toBe('10.0k');
	});

	test('formats millions', () => {
		expect(formatNumber(1000000)).toBe('1.0M');
		expect(formatNumber(1500000)).toBe('1.5M');
	});
});

describe('formatTime', () => {
	test('formats ISO timestamp', () => {
		const result = formatTime('2024-01-15T10:30:45Z');
		expect(result).toBeTruthy();
		expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
	});

	test('returns empty for empty input', () => {
		expect(formatTime('')).toBe('');
	});
});

describe('formatToolInput', () => {
	test('formats Edit tool', () => {
		const { summary, details } = formatToolInput('Edit', {
			file_path: '/tmp/test.ts',
			old_string: 'old',
			new_string: 'new',
		});
		expect(summary).toContain('/tmp/test.ts');
		expect(details).toContain('--- OLD ---');
		expect(details).toContain('+++ NEW +++');
	});

	test('formats Write tool', () => {
		const { summary } = formatToolInput('Write', {
			file_path: '/tmp/test.ts',
			content: 'line1\nline2\nline3',
		});
		expect(summary).toContain('/tmp/test.ts');
		expect(summary).toContain('3 lines');
	});

	test('formats Bash tool', () => {
		const { summary } = formatToolInput('Bash', {
			command: 'ls -la',
			description: 'List files',
		});
		expect(summary).toBe('$ ls -la');
	});

	test('formats generic tool', () => {
		const { summary, details } = formatToolInput('CustomTool', {
			param1: 'value1',
			param2: 'value2',
		});
		expect(summary).toContain('param1');
		expect(details).toContain('param1');
	});
});

describe('StreamingParser', () => {
	test('parses complete lines', () => {
		const parser = new StreamingParser();
		const entries = parser.parse(
			`${JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Hi' } })}\n`,
		);
		expect(entries).toHaveLength(1);
	});

	test('buffers incomplete lines', () => {
		const parser = new StreamingParser();

		const entries1 = parser.parse('{"type":"user"');
		expect(entries1).toHaveLength(0);

		const entries2 = parser.parse(',"userType":"external","message":{"content":"Hi"}}\n');
		expect(entries2).toHaveLength(1);
	});

	test('reset clears buffer', () => {
		const parser = new StreamingParser();
		parser.parse('incomplete');
		parser.reset();

		const entries = parser.parse(
			`${JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Hi' } })}\n`,
		);
		expect(entries).toHaveLength(1);
	});
});

describe('parseTranscriptTail', () => {
	beforeAll(() => {
		if (!existsSync(TEST_DIR)) {
			require('node:fs').mkdirSync(TEST_DIR, { recursive: true });
		}

		const lines: string[] = [];
		for (let i = 0; i < 200; i++) {
			lines.push(
				JSON.stringify({
					type: 'user',
					userType: 'external',
					message: { content: `Message ${i}` },
				}),
			);
		}
		writeFileSync(TEST_FILE, `${lines.join('\n')}\n`);
	});

	afterAll(() => {
		if (existsSync(TEST_FILE)) {
			rmSync(TEST_FILE);
		}
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true });
		}
	});

	test('loads tail entries with limit', async () => {
		const result = await parseTranscriptTail(TEST_FILE, 50);
		expect(result.entries.length).toBeLessThanOrEqual(50);
		expect(result.hasMore).toBe(true);
	});

	test('loads all entries when file is small', async () => {
		const smallFile = join(TEST_DIR, 'small-test.jsonl');
		const lines = [
			JSON.stringify({ type: 'user', userType: 'external', message: { content: 'One' } }),
			JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Two' } }),
		];
		writeFileSync(smallFile, `${lines.join('\n')}\n`);

		try {
			const result = await parseTranscriptTail(smallFile, 100);
			expect(result.entries).toHaveLength(2);
			expect(result.hasMore).toBe(false);
		} finally {
			rmSync(smallFile);
		}
	});

	test('returns empty for empty file', async () => {
		const emptyFile = join(TEST_DIR, 'empty-test.jsonl');
		writeFileSync(emptyFile, '');

		try {
			const result = await parseTranscriptTail(emptyFile, 100);
			expect(result.entries).toHaveLength(0);
			expect(result.hasMore).toBe(false);
		} finally {
			rmSync(emptyFile);
		}
	});

	test('pagination with beforeByte', async () => {
		const first = await parseTranscriptTail(TEST_FILE, 50);
		expect(first.entries.length).toBeGreaterThan(0);
		expect(first.hasMore).toBe(true);

		if (first.cursor > 0) {
			const second = await parseTranscriptTail(TEST_FILE, 50, first.cursor);
			expect(second.entries.length).toBeGreaterThan(0);
		}
	});

	test('skips trailing progress/noise lines and returns real entries', async () => {
		const noiseFile = join(TEST_DIR, 'noise-tail-test.jsonl');
		const lines = [
			JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Msg 1' } }),
			JSON.stringify({
				type: 'assistant',
				message: { content: [{ type: 'text', text: 'Reply 1' }] },
			}),
			JSON.stringify({ type: 'user', userType: 'external', message: { content: 'Msg 2' } }),
			// Trailing noise that parseEntry doesn't handle
			...Array.from({ length: 100 }, (_, i) =>
				JSON.stringify({
					type: 'progress',
					userType: 'external',
					message: { content: `progress ${i}` },
				}),
			),
			JSON.stringify({ type: 'queue-operation', data: {} }),
			JSON.stringify({ type: 'file-history-snapshot', data: {} }),
		];
		writeFileSync(noiseFile, `${lines.join('\n')}\n`);

		try {
			const result = await parseTranscriptTail(noiseFile, 50);
			expect(result.entries.length).toBe(3);
			expect(result.entries[0].content).toBe('Msg 1');
			expect(result.entries[2].content).toBe('Msg 2');
			expect(result.hasMore).toBe(false);
		} finally {
			rmSync(noiseFile);
		}
	});

	test('returns empty for file with only noise lines', async () => {
		const noiseOnlyFile = join(TEST_DIR, 'noise-only-test.jsonl');
		const lines = Array.from({ length: 50 }, (_, i) =>
			JSON.stringify({
				type: 'progress',
				userType: 'external',
				message: { content: `progress ${i}` },
			}),
		);
		writeFileSync(noiseOnlyFile, `${lines.join('\n')}\n`);

		try {
			const result = await parseTranscriptTail(noiseOnlyFile, 50);
			expect(result.entries).toHaveLength(0);
			expect(result.hasMore).toBe(false);
		} finally {
			rmSync(noiseOnlyFile);
		}
	});

	test('pagination works correctly with interleaved noise', async () => {
		const mixedFile = join(TEST_DIR, 'mixed-noise-test.jsonl');
		const lines: string[] = [];
		for (let i = 0; i < 10; i++) {
			lines.push(
				JSON.stringify({ type: 'user', userType: 'external', message: { content: `Msg ${i}` } }),
			);
			// Interleave noise between real entries
			for (let j = 0; j < 5; j++) {
				lines.push(JSON.stringify({ type: 'progress', message: { content: `p${i}-${j}` } }));
			}
		}
		writeFileSync(mixedFile, `${lines.join('\n')}\n`);

		try {
			const first = await parseTranscriptTail(mixedFile, 3);
			expect(first.entries).toHaveLength(3);
			expect(first.entries[0].content).toBe('Msg 7');
			expect(first.entries[2].content).toBe('Msg 9');
			expect(first.hasMore).toBe(true);

			const second = await parseTranscriptTail(mixedFile, 3, first.cursor);
			expect(second.entries).toHaveLength(3);
			expect(second.entries[0].content).toBe('Msg 4');
			expect(second.entries[2].content).toBe('Msg 6');
			expect(second.hasMore).toBe(true);
		} finally {
			rmSync(mixedFile);
		}
	});
});
