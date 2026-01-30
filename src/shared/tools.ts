/**
 * Tool Category Utilities
 *
 * Categorizes Claude Code tools for display and filtering.
 */

export type ToolCategory =
	| 'read'
	| 'edit'
	| 'bash'
	| 'search'
	| 'web'
	| 'task'
	| 'mcp'
	| 'skill'
	| 'other';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const TASK_TOOLS = new Set(['Task', 'TaskOutput']);
const BASH_TOOLS = new Set(['Bash', 'KillShell']);

/**
 * Get the category of a tool by name.
 * Used for:
 * - Expand toggle grouping (Read/Edit/Other)
 * - Color-coding tool badges
 */
export function getToolCategory(toolName: string): ToolCategory {
	if (toolName === 'Read') return 'read';
	if (EDIT_TOOLS.has(toolName)) return 'edit';
	if (BASH_TOOLS.has(toolName)) return 'bash';
	if (SEARCH_TOOLS.has(toolName)) return 'search';
	if (WEB_TOOLS.has(toolName)) return 'web';
	if (TASK_TOOLS.has(toolName)) return 'task';
	if (toolName.startsWith('mcp__')) return 'mcp';
	if (toolName === 'Skill') return 'skill';
	return 'other';
}

/**
 * Map tool category to expand toggle group.
 * Read → expandRead
 * Edit → expandEdit
 * Everything else → expandOther
 */
export function getExpandGroup(category: ToolCategory): 'read' | 'edit' | 'other' {
	if (category === 'read') return 'read';
	if (category === 'edit') return 'edit';
	return 'other';
}
