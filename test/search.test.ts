import { describe, expect, test } from 'bun:test';
import { fuzzyScore, scoreSession } from '../src/lib/search.ts';

describe('fuzzyScore', () => {
	test('returns 0 for empty query', () => {
		expect(fuzzyScore('', 'hello')).toBe(0);
	});

	test('returns 0 when no chars match', () => {
		expect(fuzzyScore('xyz', 'hello')).toBe(0);
	});

	test('exact substring match scores high', () => {
		const score = fuzzyScore('orbit', 'Orbit: Session Search');
		expect(score).toBeGreaterThan(50);
	});

	test('prefix match scores higher than mid-string match', () => {
		const prefix = fuzzyScore('orb', 'orbit-test');
		const mid = fuzzyScore('orb', 'test-orbit');
		expect(prefix).toBeGreaterThan(mid);
	});

	test('case insensitive matching', () => {
		const lower = fuzzyScore('orbit', 'ORBIT');
		const upper = fuzzyScore('ORBIT', 'orbit');
		expect(lower).toBe(upper);
		expect(lower).toBeGreaterThan(0);
	});

	test('contiguous chars score higher than scattered', () => {
		const contiguous = fuzzyScore('abc', 'abcdef');
		const scattered = fuzzyScore('abc', 'axbxcx');
		expect(contiguous).toBeGreaterThan(scattered);
	});

	test('returns 0 when not all query chars present', () => {
		expect(fuzzyScore('abcz', 'abcdef')).toBe(0);
	});
});

describe('scoreSession', () => {
	test('scores against ID when no name', () => {
		const score = scoreSession('a4e9', 'a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6');
		expect(score).toBeGreaterThan(0);
	});

	test('scores against name when provided', () => {
		const score = scoreSession(
			'orbit',
			'a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6',
			'Orbit: Session Search',
		);
		expect(score).toBeGreaterThan(0);
	});

	test('takes the higher score between ID and name', () => {
		const idOnlyScore = scoreSession('a4e9', 'a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6');
		const withName = scoreSession('a4e9', 'a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6', 'Orbit: Session');
		// ID match should be same regardless of name
		expect(withName).toBeGreaterThanOrEqual(idOnlyScore);
	});

	test('name match can score higher than ID match', () => {
		const nameMatch = scoreSession(
			'orbit',
			'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
			'Orbit: Search',
		);
		const idMatch = scoreSession('orbit', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
		expect(nameMatch).toBeGreaterThan(idMatch);
	});

	test('returns 0 for no match', () => {
		expect(scoreSession('zzzzz', 'a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6')).toBe(0);
		expect(scoreSession('zzzzz', 'a4e92aa8-1bc9-41fb-8cbc-48ad436b3db6', 'Orbit')).toBe(0);
	});
});
