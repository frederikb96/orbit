import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, formatTime, formatToolInput } from '../../shared/formatters.ts';
import type { ParsedEntry, ParsedToolResult, Session, TokenStats } from '../../types.ts';
import { useConfig } from '../ConfigContext.tsx';

interface TranscriptViewProps {
	session: Session;
	sessionTitle: string | null;
	entries: ParsedEntry[];
	tokens: TokenStats | null;
	transcriptLoading: boolean;
	onReload: () => void;
	expandThinking: boolean | null;
	expandToolCalls: boolean | null;
	onToggleExpandThinking: () => void;
	onToggleExpandToolCalls: () => void;
}

export function TranscriptView({
	session,
	sessionTitle,
	entries,
	tokens,
	transcriptLoading,
	onReload,
	expandThinking,
	expandToolCalls,
	onToggleExpandThinking,
	onToggleExpandToolCalls,
}: TranscriptViewProps) {
	const { config } = useConfig();
	const containerRef = useRef<HTMLDivElement>(null);
	const lastScrollTopRef = useRef(0);
	const [currentPage, setCurrentPage] = useState(1);
	const [shouldAutoscroll, setShouldAutoscroll] = useState(true);

	const pageSize = config.pageSize || 500;

	// Effective expand state (null means use config default)
	const effectiveExpandThinking = expandThinking ?? config.defaultExpandThinking;
	const effectiveExpandToolCalls = expandToolCalls ?? config.defaultExpandToolCalls;

	// Build tool result map and filter displayable entries
	const toolResultMapRef = useRef<Map<string, ParsedToolResult>>(new Map());
	const displayEntries = useMemo(() => {
		const resultMap = new Map<string, ParsedToolResult>();
		const toolCallIds = new Set<string>();

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

		toolResultMapRef.current = resultMap;

		return entries.filter((entry) => {
			if (entry.type === 'tool_result' && entry.toolResult) {
				return !toolCallIds.has(entry.toolResult.toolUseId);
			}
			return true;
		});
	}, [entries]);

	// Stable callback for looking up tool results
	const getToolResult = useCallback(
		(toolUseId: string): ParsedToolResult | undefined => toolResultMapRef.current.get(toolUseId),
		[],
	);

	// Calculate pagination
	const totalEntries = displayEntries.length;
	const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));

	// Page 1 is special: it's the LAST entries (newest) and can grow
	// Other pages are static slices from the beginning
	const getPageEntries = useCallback(() => {
		if (totalEntries === 0) return [];

		if (currentPage === 1) {
			// Page 1: newest entries (from end)
			const startIdx = Math.max(0, totalEntries - pageSize);
			return displayEntries.slice(startIdx);
		}
		// Other pages: older entries (from beginning), reverse page numbering
		const reversePageIdx = totalPages - currentPage;
		const startIdx = reversePageIdx * pageSize;
		const endIdx = Math.min(startIdx + pageSize, totalEntries);
		return displayEntries.slice(startIdx, endIdx);
	}, [displayEntries, totalEntries, totalPages, currentPage, pageSize]);

	const pageEntries = getPageEntries();

	// Auto-reload when page 1 exceeds 2x pageSize
	const page1Size = currentPage === 1 ? pageEntries.length : 0;
	const maxPage1Size = pageSize * 2;

	useEffect(() => {
		if (currentPage === 1 && page1Size > maxPage1Size) {
			onReload();
		}
	}, [currentPage, page1Size, maxPage1Size, onReload]);

	// Reset to page 1 on session change
	// biome-ignore lint/correctness/useExhaustiveDependencies: session.id intentionally triggers reset
	useEffect(() => {
		setCurrentPage(1);
		setShouldAutoscroll(true);
		lastScrollTopRef.current = 0;
	}, [session.id]);

	// Autoscroll: direction-based detection
	// scrollTop decreased → user scrolled up → disable
	// at bottom → re-enable
	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		const { scrollTop, scrollHeight, offsetHeight } = e.currentTarget;
		const isAtBottom = scrollHeight - scrollTop - offsetHeight < 50;

		if (scrollTop < lastScrollTopRef.current && !isAtBottom) {
			setShouldAutoscroll(false);
		} else if (isAtBottom) {
			setShouldAutoscroll(true);
		}

		lastScrollTopRef.current = scrollTop;
	}, []);

	// Autoscroll: scroll to bottom when new entries arrive (on page 1)
	// biome-ignore lint/correctness/useExhaustiveDependencies: entries.length intentionally triggers scroll
	useEffect(() => {
		if (shouldAutoscroll && currentPage === 1 && containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [entries.length, shouldAutoscroll, currentPage]);

	// Manual autoscroll toggle (for button click)
	const handleAutoscrollToggle = useCallback(() => {
		const newValue = !shouldAutoscroll;
		setShouldAutoscroll(newValue);
		if (newValue && containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [shouldAutoscroll]);

	// Enable autoscroll and scroll to bottom (for keyboard shortcut)
	const handleAutoscrollEnable = useCallback(() => {
		setShouldAutoscroll(true);
		if (containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, []);

	// Page navigation
	const handlePrevPage = useCallback(() => {
		if (currentPage < totalPages) {
			setCurrentPage((p) => p + 1);
			setShouldAutoscroll(false);
		}
	}, [currentPage, totalPages]);

	const handleNextPage = useCallback(() => {
		if (currentPage > 1) {
			setCurrentPage((p) => p - 1);
			if (currentPage === 2) {
				setShouldAutoscroll(true);
			}
		}
	}, [currentPage]);

	const handleReload = useCallback(() => {
		setCurrentPage(1);
		setShouldAutoscroll(true);
		lastScrollTopRef.current = 0;
		onReload();
	}, [onReload]);

	// Keyboard shortcuts (transcript-specific)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (!e.shiftKey || !e.altKey) return;

			switch (e.key.toLowerCase()) {
				case 's':
					e.preventDefault();
					handleAutoscrollEnable();
					break;
				case 'r':
					e.preventDefault();
					handleReload();
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleAutoscrollEnable, handleReload]);

	return (
		<div className="transcript-view">
			<header className="transcript-header">
				<div className="header-info">
					<span className="session-type-badge">{session.type}</span>
					{sessionTitle && <span className="session-title">{sessionTitle}</span>}
					<span className="session-id">{session.id}</span>
					{session.active && <span className="active-badge">&#x26A1; Active</span>}
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
						title={`${effectiveExpandThinking ? 'Thinking expanded' : 'Thinking collapsed'} (Shift+Alt+T)`}
					>
						&#x1F4AD; {effectiveExpandThinking ? 'Expanded' : 'Collapsed'}
					</button>
					<button
						type="button"
						className={`expand-toggle ${effectiveExpandToolCalls ? 'active' : ''}`}
						onClick={onToggleExpandToolCalls}
						title={`${effectiveExpandToolCalls ? 'Tools expanded' : 'Tools collapsed'} (Shift+Alt+O)`}
					>
						&#x1F527; {effectiveExpandToolCalls ? 'Expanded' : 'Collapsed'}
					</button>
				</div>
				<button
					type="button"
					className="reload-btn"
					onClick={handleReload}
					title="Reload transcript (Shift+Alt+R)"
				>
					&#x1F504;
				</button>
				<button
					type="button"
					className={`auto-scroll-btn ${shouldAutoscroll ? 'active' : ''}`}
					onClick={handleAutoscrollToggle}
					title={`Auto-scroll ${shouldAutoscroll ? 'ON' : 'OFF'} (Shift+Alt+S to enable)`}
				>
					{shouldAutoscroll ? '\u2193' : '\u23F8'}
				</button>
			</header>

			<div className="entries-container" ref={containerRef} onScroll={handleScroll}>
				{transcriptLoading ? (
					<div className="loading-entries">Loading transcript...</div>
				) : pageEntries.length === 0 ? (
					<div className="empty-transcript">No entries in this transcript</div>
				) : (
					pageEntries.map((entry) => (
						<MemoizedEntryCard
							key={entry.id}
							entry={entry}
							expandThinking={effectiveExpandThinking}
							expandToolCalls={effectiveExpandToolCalls}
							getToolResult={getToolResult}
						/>
					))
				)}
			</div>

			<footer className="pagination-footer">
				{totalPages > 1 && (
					<button
						type="button"
						className="page-btn"
						onClick={handlePrevPage}
						disabled={currentPage >= totalPages}
						title="View older entries"
					>
						&#x25C0; Older
					</button>
				)}
				<span className="page-info">
					{totalPages > 1 ? (
						<>
							Page {currentPage} of {totalPages} ({totalEntries} total, showing {pageEntries.length}
							)
						</>
					) : (
						<>{totalEntries} entries</>
					)}
				</span>
				{totalPages > 1 && (
					<button
						type="button"
						className="page-btn"
						onClick={handleNextPage}
						disabled={currentPage <= 1}
						title="View newer entries"
					>
						Newer &#x25B6;
					</button>
				)}
			</footer>
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
					<summary>&#x1F4AD; Thinking...</summary>
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
	const { summary, details } = useMemo(
		() => formatToolInput(tool.name, tool.input),
		[tool.name, tool.input],
	);

	return (
		<details className="tool-call" open={expanded}>
			<summary className="tool-name">
				&#x1F527; <span className="name">[{tool.name}]</span> {summary}
				{result && (
					<span
						className={`result-indicator ${result.isError ? 'error' : 'success'}`}
						aria-label={result.isError ? 'Error' : 'Success'}
					>
						{result.isError ? ' \u274C' : ' \u2713'}
					</span>
				)}
			</summary>
			{details && <pre className="tool-details">{details}</pre>}
			{result && (
				<div className={`tool-result-inline ${result.isError ? 'error' : ''}`}>
					<div className="result-header">{result.isError ? '\u274C Error' : '\u2713 Result'}</div>
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
				<span aria-label={result.isError ? 'Error' : 'Success'}>
					{result.isError ? '\u274C' : '\u2713'}
				</span>{' '}
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
				{hook.hasErrors && <span className="error-badge">&#x26A0;</span>}
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
