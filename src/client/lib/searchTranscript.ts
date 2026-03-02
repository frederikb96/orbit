import type { ParsedEntry, ParsedToolResult } from '../../types.ts';

/**
 * Check if a transcript entry matches a search query (case-insensitive).
 * Short-circuits on first match for performance.
 */
export function entryMatchesQuery(
	entry: ParsedEntry,
	queryLower: string,
	getToolResult?: (id: string) => ParsedToolResult | undefined,
): boolean {
	if (!queryLower) return false;

	if (entry.content?.toLowerCase().includes(queryLower)) return true;
	if (entry.thinking?.toLowerCase().includes(queryLower)) return true;

	if (entry.toolCalls) {
		for (const tool of entry.toolCalls) {
			if (tool.name.toLowerCase().includes(queryLower)) return true;

			const filePath = tool.input?.file_path;
			if (typeof filePath === 'string' && filePath.toLowerCase().includes(queryLower)) return true;

			const command = tool.input?.command;
			if (typeof command === 'string' && command.toLowerCase().includes(queryLower)) return true;

			const pattern = tool.input?.pattern;
			if (typeof pattern === 'string' && pattern.toLowerCase().includes(queryLower)) return true;

			if (getToolResult) {
				const result = getToolResult(tool.id);
				if (result?.content.toLowerCase().includes(queryLower)) return true;
			}
		}
	}

	if (entry.hookSummary) {
		for (const name of entry.hookSummary.hookNames) {
			if (name.toLowerCase().includes(queryLower)) return true;
		}
		for (const err of entry.hookSummary.errors) {
			if (err.toLowerCase().includes(queryLower)) return true;
		}
	}

	return false;
}
