/**
 * Language Detection Utilities
 *
 * Maps file extensions to programming language identifiers
 * for syntax highlighting.
 */

const EXTENSION_MAP: Record<string, string> = {
	// JavaScript/TypeScript
	'.ts': 'typescript',
	'.tsx': 'tsx',
	'.js': 'javascript',
	'.jsx': 'jsx',
	'.mjs': 'javascript',
	'.cjs': 'javascript',

	// Web
	'.html': 'html',
	'.htm': 'html',
	'.css': 'css',
	'.scss': 'scss',
	'.less': 'less',

	// Data formats
	'.json': 'json',
	'.jsonl': 'json',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.toml': 'toml',
	'.xml': 'xml',

	// Shell
	'.sh': 'bash',
	'.bash': 'bash',
	'.zsh': 'bash',
	'.fish': 'bash',

	// Python
	'.py': 'python',
	'.pyw': 'python',
	'.pyx': 'python',

	// Systems
	'.rs': 'rust',
	'.go': 'go',
	'.c': 'c',
	'.h': 'c',
	'.cpp': 'cpp',
	'.hpp': 'cpp',
	'.cc': 'cpp',

	// JVM
	'.java': 'java',
	'.kt': 'kotlin',
	'.kts': 'kotlin',
	'.scala': 'scala',

	// Other languages
	'.rb': 'ruby',
	'.php': 'php',
	'.lua': 'lua',
	'.r': 'r',
	'.sql': 'sql',
	'.graphql': 'graphql',
	'.gql': 'graphql',

	// Config/DevOps
	'.dockerfile': 'dockerfile',
	'.tf': 'hcl',
	'.hcl': 'hcl',
	'.ini': 'ini',
	'.env': 'bash',

	// Documentation
	'.md': 'markdown',
	'.mdx': 'markdown',
	'.rst': 'text',
	'.txt': 'text',
};

/**
 * Get the programming language for a file path.
 * Returns undefined if extension not recognized.
 */
export function getLanguageFromPath(filePath: string): string | undefined {
	const lastDot = filePath.lastIndexOf('.');
	if (lastDot === -1) {
		// Check for special filenames
		const filename = filePath.split('/').pop()?.toLowerCase();
		if (filename === 'dockerfile') return 'dockerfile';
		if (filename === 'makefile') return 'makefile';
		return undefined;
	}

	const ext = filePath.slice(lastDot).toLowerCase();
	return EXTENSION_MAP[ext];
}

/**
 * Get language for a fenced code block language hint.
 * Normalizes common aliases.
 */
export function normalizeLanguage(lang: string): string {
	const normalized = lang.toLowerCase().trim();

	const ALIASES: Record<string, string> = {
		js: 'javascript',
		ts: 'typescript',
		py: 'python',
		rb: 'ruby',
		sh: 'bash',
		shell: 'bash',
		zsh: 'bash',
		yml: 'yaml',
		dockerfile: 'docker',
	};

	return ALIASES[normalized] || normalized;
}
