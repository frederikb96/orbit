/**
 * Transcript Parser Module
 *
 * Parses Claude Code JSONL transcript files into structured entries.
 * Handles all entry types: user, assistant, system.
 */

import type {
	ContentBlock,
	PaginatedEntries,
	ParsedEntry,
	ParsedHookSummary,
	ParsedToolCall,
	ParsedToolResult,
	TokenStats,
	TokenUsage,
	TranscriptEntry,
} from '../types/index.ts';

// Re-export shared formatters for convenience
export { formatNumber, formatTime, formatToolInput } from '../shared/formatters.ts';

// Default entries to load initially and per page
export const DEFAULT_LIMIT = 100;
const CHUNK_SIZE = 256 * 1024; // 256KB chunks for reading

/**
 * Parse a single JSONL line into a ParsedEntry
 * @param line - JSONL line content
 * @param toolMap - Map of tool use IDs to tool names (for matching results)
 * @param index - Entry index for ID generation
 */
export function parseEntry(
	line: string,
	toolMap: Map<string, string>,
	index = 0,
): ParsedEntry | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	let entry: TranscriptEntry;
	try {
		entry = JSON.parse(trimmed);
	} catch {
		return null;
	}

	const id = `entry-${index}`;
	const timestamp = entry.timestamp || new Date().toISOString();

	// User entry (external prompt or tool result)
	if (entry.type === 'user' && entry.userType === 'external') {
		const content = entry.message?.content;

		// Tool result
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === 'tool_result') {
					const toolName = toolMap.get(block.tool_use_id || '') || 'unknown';
					let resultContent = block.content || '';

					// Handle array content (Task tool results are arrays)
					if (Array.isArray(resultContent)) {
						resultContent = (resultContent as ContentBlock[])
							.filter((c) => c.type === 'text' && c.text)
							.map((c) => c.text)
							.join('\n\n');
					}

					return {
						id,
						type: 'tool_result',
						timestamp,
						toolResult: {
							toolUseId: block.tool_use_id || '',
							toolName,
							content: resultContent as string,
							isError: block.is_error || false,
						},
					};
				}
			}
			return null;
		}

		// Regular user prompt
		if (typeof content === 'string' && content.trim()) {
			return {
				id,
				type: 'user',
				timestamp,
				content,
			};
		}

		return null;
	}

	// Assistant entry
	if (entry.type === 'assistant') {
		const message = entry.message;
		if (!message) return null;

		const content = message.content;
		if (!Array.isArray(content)) return null;

		let textContent = '';
		let thinking = '';
		const toolCalls: ParsedToolCall[] = [];

		for (const block of content as ContentBlock[]) {
			if (block.type === 'thinking' && block.thinking) {
				thinking += block.thinking;
			} else if (block.type === 'text' && block.text) {
				textContent += `${block.text}\n`;
			} else if (block.type === 'tool_use') {
				const toolCall: ParsedToolCall = {
					id: block.id || '',
					name: block.name || 'unknown',
					input: block.input || {},
				};
				toolCalls.push(toolCall);
				// Store for matching with results
				if (block.id && block.name) {
					toolMap.set(block.id, block.name);
				}
			}
		}

		return {
			id,
			type: 'assistant',
			timestamp,
			content: textContent.trim() || undefined,
			thinking: thinking || undefined,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			tokens: message.usage,
		};
	}

	// System entry
	if (entry.type === 'system') {
		if (entry.subtype === 'stop_hook_summary') {
			const hookInfos = entry.hookInfos || [];
			const hookErrors = entry.hookErrors || [];

			// Only include if interesting
			if (hookErrors.length > 0 || hookInfos.length > 1 || entry.preventedContinuation) {
				const hookNames = hookInfos.map((info) => {
					const cmd = info.command || '';
					const parts = cmd.split('/');
					return parts[parts.length - 1] || cmd;
				});

				return {
					id,
					type: 'system',
					timestamp,
					hookSummary: {
						hookNames,
						hasErrors: hookErrors.length > 0,
						errors: hookErrors.map((e) =>
							e.replace(/^Failed with non-blocking status code:\s*/i, ''),
						),
						preventedContinuation: entry.preventedContinuation || false,
					},
				};
			}
		}
		return null;
	}

	return null;
}

/**
 * Parse entire transcript file
 */
export function parseTranscript(content: string): { entries: ParsedEntry[]; tokens: TokenStats } {
	const lines = content.split('\n');
	const entries: ParsedEntry[] = [];
	const toolMap = new Map<string, string>();
	const tokens: TokenStats = {
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheCreationTokens: 0,
		totalCacheReadTokens: 0,
		turns: 0,
		currentContextTokens: 0,
	};

	let entryIndex = 0;
	for (const line of lines) {
		const entry = parseEntry(line, toolMap, entryIndex++);
		if (entry) {
			entries.push(entry);

			// Track tokens
			if (entry.type === 'assistant' && entry.tokens) {
				updateTokens(tokens, entry.tokens);
			}
			if (entry.type === 'user') {
				tokens.turns++;
			}
		}
	}

	return { entries, tokens };
}

/**
 * Parse the tail (most recent entries) of a transcript file.
 * Reads from end of file to avoid loading entire 30MB+ files.
 *
 * @param filePath - Path to the JSONL transcript file
 * @param limit - Maximum entries to return
 * @param beforeByte - Read entries before this byte offset (for pagination)
 */
export async function parseTranscriptTail(
	filePath: string,
	limit = DEFAULT_LIMIT,
	beforeByte?: number,
): Promise<PaginatedEntries> {
	const file = Bun.file(filePath);
	const fileSize = file.size;

	// Determine end position for reading
	const endPos = beforeByte ?? fileSize;
	if (endPos <= 0) {
		return { entries: [], cursor: 0, hasMore: false };
	}

	// Read chunks from end until we have enough entries
	const allLines: string[] = [];
	let currentEnd = endPos;
	let firstChunk = true;

	while (allLines.length < limit && currentEnd > 0) {
		const startPos = Math.max(0, currentEnd - CHUNK_SIZE);
		const chunk = await file.slice(startPos, currentEnd).text();

		// Split into lines
		const lines = chunk.split('\n');

		// Skip last line of first chunk if partial (no trailing newline)
		if (firstChunk && !chunk.endsWith('\n') && lines.length > 0) {
			lines.pop();
		}
		firstChunk = false;

		// Skip first line if partial (we started mid-line)
		if (startPos > 0 && lines.length > 0) {
			lines.shift();
		}

		// Prepend lines (they're older entries)
		allLines.unshift(...lines.filter((l) => l.trim()));

		currentEnd = startPos;
	}

	// Take only the last `limit` lines (most recent)
	const linesToParse = allLines.slice(-limit);

	// Parse entries
	const toolMap = new Map<string, string>();
	const entries: ParsedEntry[] = [];

	let entryIndex = 0;
	for (const line of linesToParse) {
		const entry = parseEntry(line, toolMap, entryIndex++);
		if (entry) {
			entries.push(entry);
		}
	}

	// Calculate cursor for loading more
	// If we read all lines, cursor is based on how many we skipped
	const skippedLines = allLines.length - linesToParse.length;
	const hasMore = currentEnd > 0 || skippedLines > 0;

	// Cursor is the byte position to read before next time
	// Approximate by scaling based on entries read
	let cursor = currentEnd;
	if (skippedLines > 0 && allLines.length > 0) {
		// Estimate byte position of older entries
		const avgBytesPerEntry = (endPos - currentEnd) / allLines.length;
		cursor = Math.max(0, Math.floor(avgBytesPerEntry * skippedLines));
	}

	return { entries, cursor, hasMore };
}

/**
 * Update token stats from usage
 */
export function updateTokens(stats: TokenStats, usage: TokenUsage): void {
	const input = Number(usage.input_tokens) || 0;
	const output = Number(usage.output_tokens) || 0;
	const cacheCreate = Number(usage.cache_creation_input_tokens) || 0;
	const cacheRead = Number(usage.cache_read_input_tokens) || 0;

	if (input > 0) stats.totalInputTokens += input;
	if (output > 0) stats.totalOutputTokens += output;
	if (cacheCreate > 0) stats.totalCacheCreationTokens += cacheCreate;
	if (cacheRead > 0) stats.totalCacheReadTokens += cacheRead;

	// Current context = input + cache tokens from this turn
	stats.currentContextTokens = input + cacheCreate + cacheRead;
}

/**
 * Streaming parser for incremental updates
 */
export class StreamingParser {
	private buffer = '';
	private toolMap = new Map<string, string>();
	private entryIndex = 0;

	/**
	 * Parse new content and return new entries
	 */
	parse(newContent: string): ParsedEntry[] {
		this.buffer += newContent;
		const entries: ParsedEntry[] = [];

		// Process complete lines
		const lines = this.buffer.split('\n');
		this.buffer = lines.pop() || ''; // Keep incomplete line

		for (const line of lines) {
			const entry = parseEntry(line, this.toolMap, this.entryIndex++);
			if (entry) {
				entries.push(entry);
			}
		}

		return entries;
	}

	/**
	 * Reset parser state
	 */
	reset(): void {
		this.buffer = '';
		this.toolMap.clear();
		this.entryIndex = 0;
	}
}
