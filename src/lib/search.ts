/**
 * Fuzzy search scoring for session search.
 *
 * Scores a query against a target string using:
 * - Prefix bonus (query matches start of target)
 * - Contiguous char bonus (consecutive matched chars)
 * - Gap penalty (skipped chars between matches)
 */

export interface SearchResult {
	id: string;
	name?: string;
	mtime: number;
	type: 'session' | 'agent';
}

/**
 * Score a query against a target string.
 * Returns 0 for no match, higher = better match.
 */
export function fuzzyScore(query: string, target: string): number {
	const q = query.toLowerCase();
	const t = target.toLowerCase();

	if (q.length === 0) return 0;
	if (t.includes(q)) {
		// Exact substring: high base score + prefix bonus
		return 100 + (t.startsWith(q) ? 50 : 0);
	}

	let score = 0;
	let qi = 0;
	let lastMatchIdx = -1;
	let contiguous = 0;

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			score += 10;

			if (qi === 0 && ti === 0) score += 20; // prefix match
			if (lastMatchIdx === ti - 1) {
				contiguous++;
				score += contiguous * 5; // increasing bonus for runs
			} else {
				contiguous = 0;
				if (lastMatchIdx >= 0) score -= 2; // gap penalty
			}

			lastMatchIdx = ti;
			qi++;
		}
	}

	// All query chars must match
	if (qi < q.length) return 0;

	return score;
}

/**
 * Score a search query against a session (checks both name and ID).
 * Returns the best score across both fields.
 */
export function scoreSession(query: string, id: string, name?: string): number {
	const idScore = fuzzyScore(query, id);
	const nameScore = name ? fuzzyScore(query, name) : 0;
	return Math.max(idScore, nameScore);
}
