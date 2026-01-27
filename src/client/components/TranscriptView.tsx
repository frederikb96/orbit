import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, formatTime, formatToolInput } from '../../shared/formatters.ts';
import type { ParsedEntry, ParsedToolResult, SessionInfo, TokenStats } from '../../types/index.ts';
import { useConfig } from '../ConfigContext.tsx';

interface TranscriptViewProps {
	session: SessionInfo;
	entries: ParsedEntry[];
	tokens: TokenStats | null;
	hasMore: boolean;
	loadingMore: boolean;
	transcriptLoading: boolean;
	onLoadMore: () => void;
	expandThinking: boolean | null;
	expandToolCalls: boolean | null;
	onToggleExpandThinking: () => void;
	onToggleExpandToolCalls: () => void;
}

export function TranscriptView({
	session,
	entries,
	tokens,
	hasMore,
	loadingMore,
	transcriptLoading,
	onLoadMore,
	expandThinking,
	expandToolCalls,
	onToggleExpandThinking,
	onToggleExpandToolCalls,
}: TranscriptViewProps) {
	const { config } = useConfig();
	const [autoScroll, setAutoScroll] = useState(true);
	const parentRef = useRef<HTMLDivElement>(null);
	const prevEntriesCountRef = useRef(entries.length);
	const prevFirstEntryIdRef = useRef<string | null>(null);
	const isLoadingMoreRef = useRef(false);

	// Effective expand state (null means use config default)
	const effectiveExpandThinking = expandThinking ?? config.defaultExpandThinking;
	const effectiveExpandToolCalls = expandToolCalls ?? config.defaultExpandToolCalls;

	// Build tool result map (stored in ref for stable reference) and filter displayable entries
	const toolResultMapRef = useRef<Map<string, ParsedToolResult>>(new Map());
	const displayEntries = useMemo(() => {
		const resultMap = new Map<string, ParsedToolResult>();
		const toolCallIds = new Set<string>();

		// First pass: collect all tool call IDs and tool results
		for (const entry of entries) {
			if (entry.type === 'tool_result' && entry.toolResult) {
				resultMap.set(entry.toolResult.toolUseId, entry.toolResult);
			}
			if (entry.type === 'assistant' && entry.toolCalls) {
				for (const tool of entry.toolCalls) {
					toolCallIds.add(tool.id);
				}
			}
		}

		// Update ref with new map
		toolResultMapRef.current = resultMap;

		// Second pass: filter out tool_results that are consumed by their tool calls
		return entries.filter((entry) => {
			if (entry.type === 'tool_result' && entry.toolResult) {
				return !toolCallIds.has(entry.toolResult.toolUseId);
			}
			return true;
		});
	}, [entries]);

	// Stable callback for looking up tool results (avoids prop reference changes)
	const getToolResult = useCallback(
		(toolUseId: string): ParsedToolResult | undefined => toolResultMapRef.current.get(toolUseId),
		[],
	);

	// Virtualizer for efficient rendering
	const virtualizer = useVirtualizer({
		count: displayEntries.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 200, // Estimate largest expected height (reduces re-measurement)
		overscan: 5, // Render 5 extra items above/below viewport
		getItemKey: (index) => displayEntries[index]?.id ?? index,
		// Disable synchronous layout flush - critical for high-frequency updates
		useFlushSync: false,
	});

	// Handle entries being prepended (when loading older)
	useEffect(() => {
		const prevCount = prevEntriesCountRef.current;
		const prevFirstId = prevFirstEntryIdRef.current;

		if (displayEntries.length > 0) {
			const currentFirstId = displayEntries[0].id;

			// Check if entries were prepended (new first entry ID)
			if (prevFirstId && prevFirstId !== currentFirstId && displayEntries.length > prevCount) {
				// Find the index of what was previously the first entry
				const previousFirstIndex = displayEntries.findIndex((e) => e.id === prevFirstId);

				if (previousFirstIndex > 0 && isLoadingMoreRef.current) {
					// Scroll to maintain position after prepend
					requestAnimationFrame(() => {
						virtualizer.scrollToIndex(previousFirstIndex, { align: 'start' });
					});
					isLoadingMoreRef.current = false;
				}
			}

			prevFirstEntryIdRef.current = currentFirstId;
		}

		prevEntriesCountRef.current = displayEntries.length;
	}, [displayEntries, virtualizer]);

	// Auto-scroll to bottom on new entries at end (using RAF + direct DOM, not state)
	useEffect(() => {
		if (autoScroll && displayEntries.length > 0 && !isLoadingMoreRef.current) {
			requestAnimationFrame(() => {
				const el = parentRef.current;
				if (el) {
					el.scrollTop = el.scrollHeight;
				}
			});
		}
	}, [displayEntries.length, autoScroll]);

	// Throttled scroll handler
	const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const handleScroll = useCallback(() => {
		if (scrollTimeoutRef.current) return;

		scrollTimeoutRef.current = setTimeout(() => {
			scrollTimeoutRef.current = null;

			const scrollEl = parentRef.current;
			if (!scrollEl) return;

			const { scrollTop, scrollHeight, clientHeight } = scrollEl;

			// Check if at bottom for auto-scroll (strict: only when truly at end)
			const isAtBottom = scrollHeight - scrollTop - clientHeight < 5;
			setAutoScroll(isAtBottom);

			// Load more when near top
			if (scrollTop < 300 && hasMore && !loadingMore && !isLoadingMoreRef.current) {
				isLoadingMoreRef.current = true;
				onLoadMore();
			}
		}, 50); // Throttle to 50ms
	}, [hasMore, loadingMore, onLoadMore]);

	// Cleanup throttle timeout on unmount
	useEffect(() => {
		return () => {
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}
		};
	}, []);

	const virtualItems = virtualizer.getVirtualItems();

	return (
		<div className="transcript-view">
			<header className="transcript-header">
				<div className="header-info">
					<span className="session-type-badge">{session.type}</span>
					<span className="session-id">{session.id}</span>
					{session.active && <span className="active-badge">⚡ Active</span>}
				</div>
				{tokens && (
					<div className="token-stats">
						<span className="token-stat context">
							Context: {formatNumber(tokens.currentContextTokens)}
						</span>
						<span className="token-stat turns">Turns: {tokens.turns}</span>
					</div>
				)}
				<div className="expand-toggles">
					<button
						type="button"
						className={`expand-toggle ${effectiveExpandThinking ? 'active' : ''}`}
						onClick={onToggleExpandThinking}
						title={
							effectiveExpandThinking
								? 'Thinking expanded (click to collapse)'
								: 'Thinking collapsed (click to expand)'
						}
					>
						💭 {effectiveExpandThinking ? 'Expanded' : 'Collapsed'}
					</button>
					<button
						type="button"
						className={`expand-toggle ${effectiveExpandToolCalls ? 'active' : ''}`}
						onClick={onToggleExpandToolCalls}
						title={
							effectiveExpandToolCalls
								? 'Tools expanded (click to collapse)'
								: 'Tools collapsed (click to expand)'
						}
					>
						🔧 {effectiveExpandToolCalls ? 'Expanded' : 'Collapsed'}
					</button>
				</div>
				<button
					type="button"
					className={`auto-scroll-btn ${autoScroll ? 'active' : ''}`}
					onClick={() => setAutoScroll(!autoScroll)}
					title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
				>
					{autoScroll ? '↓' : '⏸'}
				</button>
			</header>

			<div
				className="entries-container"
				ref={parentRef}
				onScroll={handleScroll}
				style={{ contain: 'strict' }}
			>
				{loadingMore && (
					<div className="loading-more">
						<div className="spinner-small" />
						Loading older entries...
					</div>
				)}
				{hasMore && !loadingMore && <div className="load-more-hint">↑ Scroll up to load more</div>}

				{transcriptLoading ? (
					<div className="loading-entries">Loading transcript...</div>
				) : displayEntries.length === 0 ? (
					<div className="empty-transcript">No entries in this transcript</div>
				) : (
					<div
						style={{
							height: `${virtualizer.getTotalSize()}px`,
							width: '100%',
							position: 'relative',
						}}
					>
						{virtualItems.map((virtualRow) => {
							const entry = displayEntries[virtualRow.index];
							return (
								<div
									key={virtualRow.key}
									data-index={virtualRow.index}
									ref={virtualizer.measureElement}
									style={{
										position: 'absolute',
										top: 0,
										left: 0,
										width: '100%',
										transform: `translateY(${virtualRow.start}px)`,
									}}
								>
									<MemoizedEntryCard
										entry={entry}
										expandThinking={effectiveExpandThinking}
										expandToolCalls={effectiveExpandToolCalls}
										getToolResult={getToolResult}
									/>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

interface EntryCardProps {
	entry: ParsedEntry;
	expandThinking: boolean;
	expandToolCalls: boolean;
	getToolResult: (toolUseId: string) => ParsedToolResult | undefined;
}

const MemoizedEntryCard = memo(function EntryCard({
	entry,
	expandThinking,
	expandToolCalls,
	getToolResult,
}: EntryCardProps) {
	switch (entry.type) {
		case 'user':
			return <MemoizedUserEntry entry={entry} />;
		case 'assistant':
			return (
				<MemoizedAssistantEntry
					entry={entry}
					expandThinking={expandThinking}
					expandToolCalls={expandToolCalls}
					getToolResult={getToolResult}
				/>
			);
		case 'tool_result':
			// Standalone tool_result entries (not consumed by a tool call) are already
			// filtered to displayEntries, so we always render them here
			return <MemoizedToolResultEntry entry={entry} expanded={expandToolCalls} />;
		case 'system':
			return <MemoizedSystemEntry entry={entry} />;
		default:
			return null;
	}
});

const MemoizedUserEntry = memo(function UserEntry({ entry }: { entry: ParsedEntry }) {
	return (
		<div className="entry user-entry">
			<div className="entry-header">
				<span className="role-badge user">USER</span>
				<span className="timestamp">{formatTime(entry.timestamp)}</span>
			</div>
			<div className="entry-content">
				<pre>{entry.content}</pre>
			</div>
		</div>
	);
});

interface AssistantEntryProps {
	entry: ParsedEntry;
	expandThinking: boolean;
	expandToolCalls: boolean;
	getToolResult: (toolUseId: string) => ParsedToolResult | undefined;
}

const MemoizedAssistantEntry = memo(function AssistantEntry({
	entry,
	expandThinking,
	expandToolCalls,
	getToolResult,
}: AssistantEntryProps) {
	return (
		<div className="entry assistant-entry">
			<div className="entry-header">
				<span className="role-badge assistant">ASSISTANT</span>
				<span className="timestamp">{formatTime(entry.timestamp)}</span>
				{entry.tokens && (
					<span className="tokens-badge">
						{formatNumber(entry.tokens.input_tokens || 0)} in /{' '}
						{formatNumber(entry.tokens.output_tokens || 0)} out
					</span>
				)}
			</div>

			{entry.thinking && (
				<details className="thinking-block" open={expandThinking}>
					<summary>💭 Thinking...</summary>
					<pre>{entry.thinking}</pre>
				</details>
			)}

			{entry.content && (
				<div className="entry-content">
					<pre>{entry.content}</pre>
				</div>
			)}

			{entry.toolCalls && entry.toolCalls.length > 0 && (
				<div className="tool-calls">
					{entry.toolCalls.map((tool) => (
						<MemoizedToolCallBlock
							key={tool.id}
							tool={tool}
							expanded={expandToolCalls}
							result={getToolResult(tool.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
});

interface ToolCallBlockProps {
	tool: NonNullable<ParsedEntry['toolCalls']>[0];
	expanded: boolean;
	result?: ParsedToolResult;
}

const MemoizedToolCallBlock = memo(function ToolCallBlock({
	tool,
	expanded,
	result,
}: ToolCallBlockProps) {
	// Memoize the expensive formatToolInput call
	const { summary, details } = useMemo(
		() => formatToolInput(tool.name, tool.input),
		[tool.name, tool.input],
	);

	return (
		<details className="tool-call" open={expanded}>
			<summary className="tool-name">
				🔧 <span className="name">[{tool.name}]</span> {summary}
				{result && (
					<span
						className={`result-indicator ${result.isError ? 'error' : 'success'}`}
						aria-label={result.isError ? 'Error' : 'Success'}
					>
						{result.isError ? ' ❌' : ' ✓'}
					</span>
				)}
			</summary>
			{details && <pre className="tool-details">{details}</pre>}
			{result && (
				<div className={`tool-result-inline ${result.isError ? 'error' : ''}`}>
					<div className="result-header">{result.isError ? '❌ Error' : '✓ Result'}</div>
					<pre className="result-content">{result.content}</pre>
				</div>
			)}
		</details>
	);
});

const MemoizedToolResultEntry = memo(function ToolResultEntry({
	entry,
	expanded,
}: { entry: ParsedEntry; expanded: boolean }) {
	const result = entry.toolResult;
	if (!result) return null;

	return (
		<details className={`entry tool-result-entry ${result.isError ? 'error' : ''}`} open={expanded}>
			<summary className="result-summary">
				<span aria-label={result.isError ? 'Error' : 'Success'}>{result.isError ? '❌' : '✓'}</span>{' '}
				[{result.toolName}] Result
			</summary>
			<pre className="result-content">{result.content}</pre>
		</details>
	);
});

const MemoizedSystemEntry = memo(function SystemEntry({ entry }: { entry: ParsedEntry }) {
	const hook = entry.hookSummary;
	if (!hook) return null;

	return (
		<div className={`entry system-entry ${hook.hasErrors ? 'has-errors' : ''}`}>
			<div className="entry-header">
				<span className="role-badge system">HOOK</span>
				<span className="hook-names">{hook.hookNames.join(', ')}</span>
				{hook.hasErrors && <span className="error-badge">⚠️</span>}
			</div>
			{hook.errors.length > 0 && (
				<ul className="hook-errors">
					{hook.errors.map((err) => (
						<li key={err}>{err}</li>
					))}
				</ul>
			)}
		</div>
	);
});
