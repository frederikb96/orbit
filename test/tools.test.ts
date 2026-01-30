import { describe, expect, test } from 'bun:test';
import { type ToolCategory, getExpandGroup, getToolCategory } from '../src/shared/tools.ts';

describe('getToolCategory', () => {
	describe('Read category', () => {
		test('Read tool returns read category', () => {
			expect(getToolCategory('Read')).toBe('read');
		});
	});

	describe('Edit category', () => {
		test('Edit tools return edit category', () => {
			expect(getToolCategory('Edit')).toBe('edit');
			expect(getToolCategory('Write')).toBe('edit');
			expect(getToolCategory('MultiEdit')).toBe('edit');
			expect(getToolCategory('NotebookEdit')).toBe('edit');
		});
	});

	describe('Bash category', () => {
		test('Bash tools return bash category', () => {
			expect(getToolCategory('Bash')).toBe('bash');
			expect(getToolCategory('KillShell')).toBe('bash');
		});
	});

	describe('Search category', () => {
		test('Search tools return search category', () => {
			expect(getToolCategory('Grep')).toBe('search');
			expect(getToolCategory('Glob')).toBe('search');
		});
	});

	describe('Web category', () => {
		test('Web tools return web category', () => {
			expect(getToolCategory('WebFetch')).toBe('web');
			expect(getToolCategory('WebSearch')).toBe('web');
		});
	});

	describe('Task category', () => {
		test('Task tools return task category', () => {
			expect(getToolCategory('Task')).toBe('task');
			expect(getToolCategory('TaskOutput')).toBe('task');
		});
	});

	describe('MCP category', () => {
		test('MCP tools return mcp category', () => {
			expect(getToolCategory('mcp__server__tool')).toBe('mcp');
			expect(getToolCategory('mcp__perplexity__search')).toBe('mcp');
			expect(getToolCategory('mcp__engram__store_turn')).toBe('mcp');
		});
	});

	describe('Skill category', () => {
		test('Skill tool returns skill category', () => {
			expect(getToolCategory('Skill')).toBe('skill');
		});
	});

	describe('Other category', () => {
		test('Unknown tools return other category', () => {
			expect(getToolCategory('UnknownTool')).toBe('other');
			expect(getToolCategory('TodoWrite')).toBe('other');
			expect(getToolCategory('AskUserQuestion')).toBe('other');
		});
	});
});

describe('getExpandGroup', () => {
	test('read category maps to read group', () => {
		expect(getExpandGroup('read')).toBe('read');
	});

	test('edit category maps to edit group', () => {
		expect(getExpandGroup('edit')).toBe('edit');
	});

	test('all other categories map to other group', () => {
		const otherCategories: ToolCategory[] = [
			'bash',
			'search',
			'web',
			'task',
			'mcp',
			'skill',
			'other',
		];
		for (const category of otherCategories) {
			expect(getExpandGroup(category)).toBe('other');
		}
	});
});
