/**
 * Shared Formatting Utilities
 *
 * Used by both server (transcript parsing) and client (display).
 * Pure TypeScript - no Node or browser-specific APIs.
 */

/**
 * Format number with k/M suffix for compact display
 */
export function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return n.toString();
}

/**
 * Format ISO timestamp to HH:MM:SS time string
 */
export function formatTime(ts: string): string {
	if (!ts) return '';
	return new Date(ts).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

/**
 * Format tool input for display with summary and expandable details
 */
export function formatToolInput(
	name: string,
	input: Record<string, unknown>,
): { summary: string; details: string } {
	// Edit tool - show diff
	if (name === 'Edit' && input.old_string !== undefined) {
		return {
			summary: String(input.file_path || 'unknown'),
			details: `--- OLD ---\n${input.old_string}\n\n+++ NEW +++\n${input.new_string}`,
		};
	}

	// Write tool
	if (name === 'Write' && input.content !== undefined) {
		const content = String(input.content);
		const lines = content.split('\n').length;
		return {
			summary: `${input.file_path || 'unknown'} (${lines} lines)`,
			details: content,
		};
	}

	// Read tool
	if (name === 'Read') {
		const parts: string[] = [];
		const offset = input.offset as number | undefined;
		const limit = input.limit as number | undefined;
		if (offset && limit) {
			parts.push(`lines ${offset}-${offset + limit}`);
		} else if (offset) {
			parts.push(`from line ${offset}`);
		} else if (limit) {
			parts.push(`${limit} lines`);
		}
		const meta = parts.length > 0 ? ` (${parts.join(', ')})` : '';
		return {
			summary: `${input.file_path || 'unknown'}${meta}`,
			details: '',
		};
	}

	// Bash tool
	if (name === 'Bash') {
		return {
			summary: `$ ${input.command || ''}`,
			details: input.description ? `# ${input.description}` : '',
		};
	}

	// Grep/Glob tools
	if (name === 'Grep' || name === 'Glob') {
		return {
			summary: `${name}: ${input.pattern || ''}`,
			details: input.path ? `Path: ${input.path}` : '',
		};
	}

	// Task tool
	if (name === 'Task') {
		return {
			summary: String(input.description || input.subagent_type || 'unknown'),
			details: input.prompt ? String(input.prompt) : '',
		};
	}

	// Generic fallback
	const keys = Object.keys(input).slice(0, 3);
	const summary = keys
		.map((k) => {
			const v = input[k];
			const str = typeof v === 'string' ? v : JSON.stringify(v);
			return `${k}: ${str.slice(0, 50)}`;
		})
		.join(', ');

	return {
		summary: summary || '(empty)',
		details: JSON.stringify(input, null, 2),
	};
}

/**
 * Strip `cat -n` line number prefixes from Read tool output.
 * Claude Code Read tool returns content as "  1→content\n  2→content\n..."
 * Returns cleaned content and the starting line number.
 */
export function stripReadLineNumbers(content: string): {
	content: string;
	startLine: number;
	lineCount: number;
} {
	const lines = content.split('\n');
	// Check if first non-empty line matches cat -n format: spaces + digits + → or tab
	const catNPattern = /^\s*(\d+)[→\t]/;
	const firstLine = lines.find((l) => l.trim().length > 0);
	if (!firstLine || !catNPattern.test(firstLine)) {
		return { content, startLine: 1, lineCount: lines.length };
	}

	let startLine = 1;
	const stripped = lines.map((line, i) => {
		const match = line.match(catNPattern);
		if (match) {
			if (i === 0) startLine = Number.parseInt(match[1], 10);
			return line.replace(catNPattern, '');
		}
		return line;
	});

	// Trim trailing empty lines (dead space from file padding)
	while (stripped.length > 1 && stripped[stripped.length - 1].trim() === '') {
		stripped.pop();
	}

	const result = stripped.join('\n');
	return { content: result, startLine, lineCount: stripped.length };
}
