import { describe, expect, test } from 'bun:test';
import { getLanguageFromPath, normalizeLanguage } from '../src/shared/languages.ts';

describe('getLanguageFromPath', () => {
	describe('JavaScript/TypeScript', () => {
		test('detects TypeScript files', () => {
			expect(getLanguageFromPath('src/file.ts')).toBe('typescript');
			expect(getLanguageFromPath('component.tsx')).toBe('tsx');
		});

		test('detects JavaScript files', () => {
			expect(getLanguageFromPath('script.js')).toBe('javascript');
			expect(getLanguageFromPath('component.jsx')).toBe('jsx');
			expect(getLanguageFromPath('module.mjs')).toBe('javascript');
		});
	});

	describe('Web languages', () => {
		test('detects HTML/CSS', () => {
			expect(getLanguageFromPath('index.html')).toBe('html');
			expect(getLanguageFromPath('styles.css')).toBe('css');
			expect(getLanguageFromPath('styles.scss')).toBe('scss');
		});
	});

	describe('Data formats', () => {
		test('detects JSON/YAML/TOML', () => {
			expect(getLanguageFromPath('config.json')).toBe('json');
			expect(getLanguageFromPath('config.yaml')).toBe('yaml');
			expect(getLanguageFromPath('config.yml')).toBe('yaml');
			expect(getLanguageFromPath('Cargo.toml')).toBe('toml');
		});
	});

	describe('Shell scripts', () => {
		test('detects shell scripts', () => {
			expect(getLanguageFromPath('script.sh')).toBe('bash');
			expect(getLanguageFromPath('script.bash')).toBe('bash');
			expect(getLanguageFromPath('.env')).toBe('bash');
		});
	});

	describe('Other languages', () => {
		test('detects Python', () => {
			expect(getLanguageFromPath('script.py')).toBe('python');
		});

		test('detects Rust', () => {
			expect(getLanguageFromPath('main.rs')).toBe('rust');
		});

		test('detects Go', () => {
			expect(getLanguageFromPath('main.go')).toBe('go');
		});
	});

	describe('Special filenames', () => {
		test('detects Dockerfile', () => {
			expect(getLanguageFromPath('Dockerfile')).toBe('dockerfile');
			expect(getLanguageFromPath('/path/to/Dockerfile')).toBe('dockerfile');
		});

		test('detects Makefile', () => {
			expect(getLanguageFromPath('Makefile')).toBe('makefile');
		});
	});

	describe('Unknown extensions', () => {
		test('returns undefined for unknown', () => {
			expect(getLanguageFromPath('file.xyz')).toBeUndefined();
			expect(getLanguageFromPath('noextension')).toBeUndefined();
		});
	});

	describe('Case insensitivity', () => {
		test('handles uppercase extensions', () => {
			expect(getLanguageFromPath('FILE.TS')).toBe('typescript');
			expect(getLanguageFromPath('FILE.JSON')).toBe('json');
		});
	});
});

describe('normalizeLanguage', () => {
	test('normalizes common aliases', () => {
		expect(normalizeLanguage('js')).toBe('javascript');
		expect(normalizeLanguage('ts')).toBe('typescript');
		expect(normalizeLanguage('py')).toBe('python');
		expect(normalizeLanguage('sh')).toBe('bash');
		expect(normalizeLanguage('shell')).toBe('bash');
		expect(normalizeLanguage('yml')).toBe('yaml');
	});

	test('handles case insensitivity', () => {
		expect(normalizeLanguage('JS')).toBe('javascript');
		expect(normalizeLanguage('TypeScript')).toBe('typescript');
	});

	test('returns unknown languages as-is', () => {
		expect(normalizeLanguage('rust')).toBe('rust');
		expect(normalizeLanguage('go')).toBe('go');
		expect(normalizeLanguage('kotlin')).toBe('kotlin');
	});

	test('trims whitespace', () => {
		expect(normalizeLanguage('  typescript  ')).toBe('typescript');
	});
});
