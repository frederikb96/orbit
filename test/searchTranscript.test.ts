import { describe, expect, test } from 'bun:test';
import { entryMatchesQuery } from '../src/client/lib/searchTranscript.ts';
import type { ParsedEntry, ParsedToolResult } from '../src/types.ts';

function makeEntry(overrides: Partial<ParsedEntry> = {}): ParsedEntry {
	return {
		id: 'test-1',
		type: 'assistant',
		timestamp: '2026-03-02T12:00:00Z',
		...overrides,
	};
}

describe('entryMatchesQuery', () => {
	test('returns false for empty query', () => {
		expect(entryMatchesQuery(makeEntry({ content: 'hello' }), '')).toBe(false);
	});

	test('matches entry content (case insensitive)', () => {
		const entry = makeEntry({ content: 'Hello World' });
		expect(entryMatchesQuery(entry, 'hello')).toBe(true);
		expect(entryMatchesQuery(entry, 'world')).toBe(true);
		expect(entryMatchesQuery(entry, 'xyz')).toBe(false);
	});

	test('matches thinking text', () => {
		const entry = makeEntry({ thinking: 'Let me analyze the error' });
		expect(entryMatchesQuery(entry, 'analyze')).toBe(true);
		expect(entryMatchesQuery(entry, 'error')).toBe(true);
		expect(entryMatchesQuery(entry, 'missing')).toBe(false);
	});

	test('matches tool call name', () => {
		const entry = makeEntry({
			toolCalls: [{ id: 't1', name: 'Read', input: { file_path: '/src/app.ts' } }],
		});
		expect(entryMatchesQuery(entry, 'read')).toBe(true);
	});

	test('matches tool call file_path', () => {
		const entry = makeEntry({
			toolCalls: [{ id: 't1', name: 'Read', input: { file_path: '/src/components/App.tsx' } }],
		});
		expect(entryMatchesQuery(entry, 'app.tsx')).toBe(true);
		expect(entryMatchesQuery(entry, 'components')).toBe(true);
	});

	test('matches tool call command', () => {
		const entry = makeEntry({
			toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'bun test' } }],
		});
		expect(entryMatchesQuery(entry, 'bun test')).toBe(true);
	});

	test('matches tool call pattern', () => {
		const entry = makeEntry({
			toolCalls: [{ id: 't1', name: 'Grep', input: { pattern: 'TODO|FIXME' } }],
		});
		expect(entryMatchesQuery(entry, 'fixme')).toBe(true);
	});

	test('matches tool result content via getToolResult', () => {
		const entry = makeEntry({
			toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'ls' } }],
		});
		const mockGetResult = (id: string): ParsedToolResult | undefined => {
			if (id === 't1') return { toolUseId: 't1', content: 'file1.ts\nfile2.ts', isError: false };
			return undefined;
		};
		expect(entryMatchesQuery(entry, 'file1', mockGetResult)).toBe(true);
		expect(entryMatchesQuery(entry, 'file3', mockGetResult)).toBe(false);
	});

	test('matches hook summary names', () => {
		const entry = makeEntry({
			type: 'system',
			hookSummary: {
				hookNames: ['PreCommitHook'],
				hasErrors: false,
				errors: [],
				preventedContinuation: false,
			},
		});
		expect(entryMatchesQuery(entry, 'precommit')).toBe(true);
	});

	test('matches hook summary errors', () => {
		const entry = makeEntry({
			type: 'system',
			hookSummary: {
				hookNames: ['LintHook'],
				hasErrors: true,
				errors: ['ESLint found 3 warnings'],
				preventedContinuation: false,
			},
		});
		expect(entryMatchesQuery(entry, 'eslint')).toBe(true);
		expect(entryMatchesQuery(entry, 'warnings')).toBe(true);
	});

	test('short-circuits on first match', () => {
		const entry = makeEntry({
			content: 'match here',
			thinking: 'also match here',
			toolCalls: [{ id: 't1', name: 'Read', input: {} }],
		});
		expect(entryMatchesQuery(entry, 'match')).toBe(true);
	});

	test('returns false when nothing matches', () => {
		const entry = makeEntry({
			content: 'hello world',
			thinking: 'some thoughts',
			toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'ls' } }],
		});
		expect(entryMatchesQuery(entry, 'zzzznotfound')).toBe(false);
	});
});
