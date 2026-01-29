/**
 * Orbit Type Definitions
 *
 * Central type definitions for the entire application.
 */

// Configuration types
export interface OrbitConfig {
	sessions: {
		count: number; // Number of sessions to track, default 10
		refreshIntervalMs: number; // Refresh interval, default 5000
		watchPath: string; // Base path, default ~/.claude/projects
		activeThresholdMs: number; // Session active if modified within this time, default 60000
	};
	transcript: {
		initialLines: number; // Lines to load initially, default 100
	};
	ui: UIConfig;
	server: {
		port: number; // HTTP port, default 3000
	};
}

// UI configuration (sent to client)
export interface UIConfig {
	defaultExpandThinking: boolean;
	defaultExpandToolCalls: boolean;
	pageSize: number; // Entries per page (default 500)
	maxSessions: number; // Limit sidebar sessions, 0 = unlimited
	sessionPollIntervalMs: number; // Client poll interval, 0 = disabled
	recentSessionsLimit: number; // Max recent sessions in sidebar
	sseMaxRetries: number; // Max SSE reconnect attempts
	sseBaseDelayMs: number; // Base delay for SSE reconnect
	sseMaxDelayMs: number; // Max delay for SSE reconnect
	sessionTitleCommand?: string; // Bash command to fetch session title, {sessionId} placeholder
	sessionTitleIntervalMs?: number; // Interval to refresh titles (default 15000)
}

// Session types
export type SessionType = 'session' | 'agent';

export interface Session {
	id: string;
	path: string; // Server-only, stripped from API responses
	type: SessionType;
	lastSeen: number; // mtime in ms
	mtime: number; // alias for lastSeen (client compatibility)
	active: boolean; // true if modified within activeThresholdMs
}

// Transcript entry types (Claude Code JSONL format)
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

// Token tracking
export interface TokenStats {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheCreationTokens: number;
	totalCacheReadTokens: number;
	turns: number;
	currentContextTokens: number;
}

// Parsed entry for display
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

// Pagination
export interface PaginatedEntries {
	entries: ParsedEntry[];
	cursor: number; // byte offset for loading more
	hasMore: boolean;
}

// SSE event types
export type SSEEventType = 'init' | 'batch' | 'truncated' | 'ping' | 'sessions';

export interface SSEEvent {
	type: SSEEventType;
	sessionId: string;
	entries?: ParsedEntry[];
	cursor?: number;
	hasMore?: boolean;
}
