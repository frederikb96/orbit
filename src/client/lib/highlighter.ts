/**
 * Async Syntax Highlighter
 *
 * Lazy-loads Shiki on first use and provides async highlighting
 * with caching for repeated code blocks.
 */

import type { BundledLanguage, Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;
const htmlCache = new Map<string, string>();

// Common languages to preload for faster first highlighting
const PRELOAD_LANGS: BundledLanguage[] = [
	'typescript',
	'javascript',
	'json',
	'bash',
	'python',
	'markdown',
];

/**
 * Get or create the Shiki highlighter instance.
 * Lazy-loads Shiki WASM on first call.
 */
async function getHighlighter(): Promise<Highlighter> {
	if (!highlighterPromise) {
		highlighterPromise = import('shiki').then(({ createHighlighter }) =>
			createHighlighter({
				themes: ['one-dark-pro'],
				langs: PRELOAD_LANGS,
			}),
		);
	}
	return highlighterPromise;
}

/**
 * Generate a cache key for code + language combo.
 * Uses content hash for better distribution.
 */
function cacheKey(code: string, language: string): string {
	// Simple hash based on length and sample of content
	let hash = 0;
	const sample = code.slice(0, 200) + code.slice(-100);
	for (let i = 0; i < sample.length; i++) {
		hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0;
	}
	return `${language}:${code.length}:${hash}`;
}

/**
 * Highlight code asynchronously with caching.
 * Returns highlighted HTML string or null if language not supported.
 */
export async function highlightAsync(code: string, language: string): Promise<string | null> {
	const key = cacheKey(code, language);

	// Check cache first
	const cached = htmlCache.get(key);
	if (cached) return cached;

	try {
		const highlighter = await getHighlighter();

		// Load language on demand if not preloaded
		const loadedLangs = highlighter.getLoadedLanguages();
		if (!loadedLangs.includes(language as BundledLanguage)) {
			try {
				await highlighter.loadLanguage(language as BundledLanguage);
			} catch {
				// Language not supported by Shiki
				return null;
			}
		}

		const html = highlighter.codeToHtml(code, {
			lang: language as BundledLanguage,
			theme: 'one-dark-pro',
		});

		// Cache the result
		htmlCache.set(key, html);

		// Limit cache size (simple strategy: clear oldest when too large)
		if (htmlCache.size > 500) {
			const firstKey = htmlCache.keys().next().value;
			if (firstKey) htmlCache.delete(firstKey);
		}

		return html;
	} catch (err) {
		console.warn('Highlighting failed:', err);
		return null;
	}
}

/**
 * Check if a language is likely supported by Shiki.
 * This is a heuristic - actual support is checked during highlighting.
 */
export function isLikelySupported(language: string): boolean {
	// Shiki supports most common languages
	const supported = new Set([
		'typescript',
		'tsx',
		'javascript',
		'jsx',
		'json',
		'html',
		'css',
		'scss',
		'less',
		'yaml',
		'toml',
		'xml',
		'bash',
		'shell',
		'python',
		'rust',
		'go',
		'c',
		'cpp',
		'java',
		'kotlin',
		'scala',
		'ruby',
		'php',
		'lua',
		'r',
		'sql',
		'graphql',
		'dockerfile',
		'docker',
		'hcl',
		'markdown',
		'md',
		'text',
		'plaintext',
	]);
	return supported.has(language.toLowerCase());
}
