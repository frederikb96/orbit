import { describe, expect, test } from 'bun:test';
import { isValidSessionFilename, isValidSessionId } from '../src/lib/sessions.ts';

describe('isValidSessionFilename', () => {
	describe('UUID patterns', () => {
		test('accepts valid UUID session files', () => {
			expect(isValidSessionFilename('a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6.jsonl')).toBe(true);
			expect(isValidSessionFilename('00000000-0000-0000-0000-000000000000.jsonl')).toBe(true);
			expect(isValidSessionFilename('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF.jsonl')).toBe(true);
		});

		test('rejects invalid UUID patterns', () => {
			expect(isValidSessionFilename('not-a-uuid.jsonl')).toBe(false);
			expect(isValidSessionFilename('a4e92aa8-1bc9-41fb-8cbc.jsonl')).toBe(false);
			expect(isValidSessionFilename('a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6-extra.jsonl')).toBe(
				false,
			);
		});
	});

	describe('Agent patterns', () => {
		test('accepts agent files with any hex ID length (7+)', () => {
			expect(isValidSessionFilename('agent-a637779.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-1234567.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-abcdef0.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-12345678.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-a9ffc2ab775c09e1d.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-a35cd2dc480e5bd02.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-0f1214867f7e4a09dbaaaa0671e.jsonl')).toBe(true);
		});

		test('rejects agent files with too-short hex ID', () => {
			expect(isValidSessionFilename('agent-123456.jsonl')).toBe(false);
			expect(isValidSessionFilename('agent-abc.jsonl')).toBe(false);
		});

		test('rejects compact and prompt_suggestion files', () => {
			expect(isValidSessionFilename('agent-acompact-006389.jsonl')).toBe(false);
			expect(isValidSessionFilename('agent-acompact-00c79b83ab96b1a8.jsonl')).toBe(false);
			expect(isValidSessionFilename('agent-aprompt_suggestion-a637779.jsonl')).toBe(false);
			expect(isValidSessionFilename('agent-foo-1234567.jsonl')).toBe(false);
		});

		test('rejects agent files with invalid hex chars', () => {
			expect(isValidSessionFilename('agent-ghijklm.jsonl')).toBe(false);
		});

		test('accepts uppercase hex (case-insensitive)', () => {
			expect(isValidSessionFilename('agent-ABCDEF0.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-AbCdEf0.jsonl')).toBe(true);
		});
	});

	describe('Extension handling', () => {
		test('strips .jsonl extension before matching', () => {
			// Function is designed to work with .jsonl files (filtered by discovery.ts)
			expect(isValidSessionFilename('a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6.jsonl')).toBe(true);
			expect(isValidSessionFilename('agent-1234567.jsonl')).toBe(true);
		});

		test('still works without extension (matches base pattern)', () => {
			// Extension stripping is tolerant - UUID and agent patterns still match
			expect(isValidSessionFilename('a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6')).toBe(true);
			expect(isValidSessionFilename('agent-1234567')).toBe(true);
		});

		test('rejects other extensions (pattern mismatch after strip)', () => {
			// Non-.jsonl extensions don't match because extension is not stripped
			expect(isValidSessionFilename('a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6.json')).toBe(false);
			expect(isValidSessionFilename('agent-1234567.txt')).toBe(false);
		});
	});

	describe('Edge cases', () => {
		test('rejects empty string', () => {
			expect(isValidSessionFilename('')).toBe(false);
		});

		test('rejects other common files', () => {
			expect(isValidSessionFilename('config.jsonl')).toBe(false);
			expect(isValidSessionFilename('test.jsonl')).toBe(false);
			expect(isValidSessionFilename('.jsonl')).toBe(false);
		});
	});
});

describe('isValidSessionId', () => {
	describe('UUID session IDs', () => {
		test('accepts valid UUIDs', () => {
			expect(isValidSessionId('a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6')).toBe(true);
			expect(isValidSessionId('00000000-0000-0000-0000-000000000000')).toBe(true);
			expect(isValidSessionId('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toBe(true);
		});

		test('rejects invalid UUIDs', () => {
			expect(isValidSessionId('not-a-uuid')).toBe(false);
			expect(isValidSessionId('a4e92aa8-1bc9-41fb-8cbc')).toBe(false);
		});
	});

	describe('Agent IDs (hex, 7+ chars)', () => {
		test('accepts valid 7-char agent IDs', () => {
			expect(isValidSessionId('a637779')).toBe(true);
			expect(isValidSessionId('1234567')).toBe(true);
		});

		test('accepts valid 8-char agent IDs', () => {
			expect(isValidSessionId('12345678')).toBe(true);
			expect(isValidSessionId('abcdef01')).toBe(true);
		});

		test('accepts longer hex agent IDs (15, 17, 25 chars)', () => {
			expect(isValidSessionId('a9ffc2ab775c09e1d')).toBe(true);
			expect(isValidSessionId('a35cd2dc480e5bd02')).toBe(true);
			expect(isValidSessionId('0f1214867f7e4a09dbaaaa0671e')).toBe(true);
		});

		test('accepts uppercase hex (case-insensitive)', () => {
			expect(isValidSessionId('ABCDEF0')).toBe(true);
			expect(isValidSessionId('AbCdEf01')).toBe(true);
		});

		test('rejects too-short IDs', () => {
			expect(isValidSessionId('123456')).toBe(false);
			expect(isValidSessionId('abc')).toBe(false);
		});

		test('rejects non-hex chars', () => {
			expect(isValidSessionId('ghijklm')).toBe(false);
		});
	});

	describe('Security - rejects injection attempts', () => {
		test('rejects shell metacharacters', () => {
			expect(isValidSessionId('; rm -rf /')).toBe(false);
			expect(isValidSessionId('$(whoami)')).toBe(false);
			expect(isValidSessionId('`id`')).toBe(false);
			expect(isValidSessionId('| cat /etc/passwd')).toBe(false);
		});

		test('rejects empty and whitespace', () => {
			expect(isValidSessionId('')).toBe(false);
			expect(isValidSessionId(' ')).toBe(false);
			expect(isValidSessionId('  1234567  ')).toBe(false);
		});
	});
});
