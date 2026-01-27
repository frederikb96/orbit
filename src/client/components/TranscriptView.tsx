import { useEffect, useRef, useState } from 'react';
import { formatNumber, formatTime, formatToolInput } from '../../shared/formatters.ts';
import type { ParsedEntry, SessionInfo, TokenStats } from '../../types/index.ts';

interface TranscriptViewProps {
	session: SessionInfo;
	entries: ParsedEntry[];
	tokens: TokenStats | null;
	hasMore: boolean;
	loadingMore: boolean;
	onLoadMore: () => void;
}

export function TranscriptView({
	session,
	entries,
	tokens,
	hasMore,
	loadingMore,
	onLoadMore,
}: TranscriptViewProps) {
	const [autoScroll, setAutoScroll] = useState(true);
	const containerRef = useRef<HTMLDivElement>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const prevEntriesLengthRef = useRef(entries.length);
	const prevScrollHeightRef = useRef(0);

	// Auto-scroll to bottom on new entries (only if autoScroll enabled and entries were appended)
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// If entries were prepended (older loaded), maintain scroll position
		if (entries.length > prevEntriesLengthRef.current && prevScrollHeightRef.current > 0) {
			const scrollHeightDiff = container.scrollHeight - prevScrollHeightRef.current;
			if (scrollHeightDiff > 0 && container.scrollTop < 100) {
				// Entries prepended - adjust scroll to maintain position
				container.scrollTop += scrollHeightDiff;
			}
		}

		// Auto-scroll to bottom for new entries at end
		if (autoScroll && bottomRef.current) {
			bottomRef.current.scrollIntoView({ behavior: 'smooth' });
		}

		prevEntriesLengthRef.current = entries.length;
	}, [entries, autoScroll]);

	// Store scroll height before render for position restoration
	useEffect(() => {
		if (containerRef.current) {
			prevScrollHeightRef.current = containerRef.current.scrollHeight;
		}
	});

	// Detect manual scroll and trigger load more when near top
	const handleScroll = () => {
		if (!containerRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = containerRef.current;

		// Check if at bottom
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
		setAutoScroll(isAtBottom);

		// Load more when scrolling near top
		if (scrollTop < 200 && hasMore && !loadingMore) {
			onLoadMore();
		}
	};

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
				<button
					type="button"
					className={`auto-scroll-btn ${autoScroll ? 'active' : ''}`}
					onClick={() => setAutoScroll(!autoScroll)}
					title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
				>
					{autoScroll ? '↓' : '⏸'}
				</button>
			</header>

			<div className="entries-container" ref={containerRef} onScroll={handleScroll}>
				{loadingMore && (
					<div className="loading-more">
						<div className="spinner-small" />
						Loading older entries...
					</div>
				)}
				{hasMore && !loadingMore && <div className="load-more-hint">↑ Scroll up to load more</div>}
				{entries.length === 0 ? (
					<div className="loading-entries">Loading transcript...</div>
				) : (
					entries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
				)}
				<div ref={bottomRef} />
			</div>
		</div>
	);
}

interface EntryCardProps {
	entry: ParsedEntry;
}

function EntryCard({ entry }: EntryCardProps) {
	switch (entry.type) {
		case 'user':
			return <UserEntry entry={entry} />;
		case 'assistant':
			return <AssistantEntry entry={entry} />;
		case 'tool_result':
			return <ToolResultEntry entry={entry} />;
		case 'system':
			return <SystemEntry entry={entry} />;
		default:
			return null;
	}
}

function UserEntry({ entry }: { entry: ParsedEntry }) {
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
}

function AssistantEntry({ entry }: { entry: ParsedEntry }) {
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
				<details className="thinking-block">
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
						<ToolCallBlock key={tool.id} tool={tool} />
					))}
				</div>
			)}
		</div>
	);
}

function ToolCallBlock({ tool }: { tool: NonNullable<ParsedEntry['toolCalls']>[0] }) {
	const { summary, details } = formatToolInput(tool.name, tool.input);

	return (
		<details className="tool-call">
			<summary className="tool-name">
				🔧 <span className="name">[{tool.name}]</span> {summary}
			</summary>
			{details && <pre className="tool-details">{details}</pre>}
		</details>
	);
}

function ToolResultEntry({ entry }: { entry: ParsedEntry }) {
	const result = entry.toolResult;
	if (!result) return null;

	return (
		<details className={`entry tool-result-entry ${result.isError ? 'error' : ''}`}>
			<summary className="result-summary">
				{result.isError ? '❌' : '✓'} [{result.toolName}] Result
			</summary>
			<pre className="result-content">{result.content}</pre>
		</details>
	);
}

function SystemEntry({ entry }: { entry: ParsedEntry }) {
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
}
