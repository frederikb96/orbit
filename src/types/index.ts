// Log levels for structured logging
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Log entry structure (NDJSON format)
export interface LogEntry {
	ts: string;
	lvl: LogLevel;
	op: string;
	[key: string]: unknown;
}

// Session types
export type SessionType = 'session' | 'agent';

export interface SessionInfo {
	id: string;
	type: SessionType;
	path: string;
	mtime: number;
	size: number;
	active: boolean; // true if modified in last 60s
}

// Transcript entry types (from Claude Code JSONL)
export type EntryType = 'user' | 'assistant' | 'system';

export interface TranscriptEntry {
	type: EntryType;
	timestamp?: string;
	message?: {
		role?: string;
		content?: string | ContentBlock[];
		usage?: TokenUsage;
	};
	userType?: string;
	subtype?: string;
	hookInfos?: HookInfo[];
	hookErrors?: string[];
	preventedContinuation?: boolean;
}

export interface ContentBlock {
	type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: string | ContentBlock[];
	is_error?: boolean;
}

export interface TokenUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

export interface HookInfo {
	command?: string;
}

// Token tracking state
export interface TokenStats {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheCreationTokens: number;
	totalCacheReadTokens: number;
	turns: number;
	currentContextTokens: number;
}

// Parsed entry for frontend display
export interface ParsedEntry {
	id: string;
	type: 'user' | 'assistant' | 'system' | 'tool_result';
	timestamp: string;
	content?: string;
	thinking?: string;
	toolCalls?: ParsedToolCall[];
	toolResult?: ParsedToolResult;
	hookSummary?: ParsedHookSummary;
	tokens?: TokenUsage;
}

export interface ParsedToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ParsedToolResult {
	toolUseId: string;
	toolName?: string;
	content: string;
	isError: boolean;
}

export interface ParsedHookSummary {
	hookNames: string[];
	hasErrors: boolean;
	errors: string[];
	preventedContinuation: boolean;
}

// SSE event types
export type SSEEventType = 'session:list' | 'entry:new' | 'session:update' | 'ping';

export interface SSEEvent {
	type: SSEEventType;
	data: unknown;
}

// Server state
export interface ServerState {
	port: number;
	pid: number;
	startedAt: string;
}

// Pagination for transcript loading
export interface PaginatedEntries {
	entries: ParsedEntry[];
	cursor: number; // byte offset for loading more
	hasMore: boolean;
}
