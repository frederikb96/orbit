import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ItemProps, Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { formatNumber, formatTime, formatToolInput } from '../../shared/formatters.ts';
import { getLanguageFromPath } from '../../shared/languages.ts';
import { getExpandGroup, getToolCategory } from '../../shared/tools.ts';
import type { ParsedEntry, ParsedToolResult, Session, TokenStats } from '../../types.ts';
import { useConfig } from '../ConfigContext.tsx';
import { EntryProvider, type ExpandState, useEntryContext } from '../EntryContext.tsx';
import { AnsiText } from './AnsiText.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { CopyButton } from './CopyButton.tsx';
import { LazyDiffView } from './LazyDiffView.tsx';
import { Markdown } from './Markdown.tsx';

// Fractional item size measurement for sub-pixel accuracy
function fractionalItemSize(element: HTMLElement) {
	return element.getBoundingClientRect().height;
}

// Item wrapper traps CSS margins, preventing measurement errors
const VirtuosoItem = React.forwardRef<HTMLDivElement, ItemProps<unknown>>((props, ref) => (
	<div {...props} ref={ref} style={{ display: 'inline-block', width: '100%' }} />
));

export interface ArchiveViewProps {
	session: Session;
	sessionTitle: string | null;
	snapshotTimestamp: string;
	entries: ParsedEntry[];
	isLoading: boolean;
	loadingProgress: number;
	hasMore: boolean;
	newEntriesCount: number;
	tokens: TokenStats | null;
	totalCount?: number; // Row 32: Total entries for progress calculation
	memoryWarning?: boolean; // Row 33: True if memory limit was hit
	firstItemIndex: number; // Row 13: Virtual index for prepended content
	onLoadMore: () => void;
	onRefresh: () => void;
	onSwitchToLive: () => void;
	expandThinking: boolean | null;
	expandRead: boolean | null;
	expandEdit: boolean | null;
	expandOther: boolean | null;
	onToggleExpandThinking: () => void;
	onToggleExpandRead: () => void;
	onToggleExpandEdit: () => void;
	onToggleExpandOther: () => void;
}

export function ArchiveView({
	session,
	sessionTitle,
	snapshotTimestamp,
	entries,
	isLoading,
	loadingProgress,
	hasMore,
	newEntriesCount,
	tokens,
	totalCount,
	memoryWarning = false,
	firstItemIndex,
	onLoadMore,
	onRefresh,
	onSwitchToLive,
	expandThinking,
	expandRead,
	expandEdit,
	expandOther,
	onToggleExpandThinking,
	onToggleExpandRead,
	onToggleExpandEdit,
	onToggleExpandOther,
}: ArchiveViewProps) {
	const { config } = useConfig();
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const [isPaused, setIsPaused] = useState(false);
	const isAtBottomRef = useRef(true);
	const isInitialScrollDone = useRef(false);
	const prevEntriesLength = useRef(0);

	// Anchor preservation for refresh
	const [anchorEntryId, setAnchorEntryId] = useState<string | null>(null);
	const pendingAnchorRestore = useRef(false);
	const visibleStartIndexRef = useRef(0);

	// Effective expand states (null means use config default)
	const effectiveExpandThinking = expandThinking ?? config.defaultExpandThinking;
	const effectiveExpandRead = expandRead ?? config.defaultExpandRead;
	const effectiveExpandEdit = expandEdit ?? config.defaultExpandEdit;
	const effectiveExpandOther = expandOther ?? config.defaultExpandOther;

	// Memoized expand state object for context (stable reference)
	const expandState: ExpandState = useMemo(
		() => ({
			thinking: effectiveExpandThinking,
			read: effectiveExpandRead,
			edit: effectiveExpandEdit,
			other: effectiveExpandOther,
		}),
		[effectiveExpandThinking, effectiveExpandRead, effectiveExpandEdit, effectiveExpandOther],
	);

	// Build tool result map for inline display via getToolResult()
	const toolResultMapRef = useRef<Map<string, ParsedToolResult>>(new Map());
	const displayEntries = useMemo(() => {
		const resultMap = new Map<string, ParsedToolResult>();

		for (const entry of entries) {
			if (entry.type === 'tool_result' && entry.toolResult) {
				resultMap.set(entry.toolResult.toolUseId, entry.toolResult);
			}
		}

		toolResultMapRef.current = resultMap;

		// Filter out all tool_result entries - they display inline via getToolResult()
		return entries.filter((entry) => entry.type !== 'tool_result');
	}, [entries]);

	// Stable callback for looking up tool results
	const getToolResult = useCallback(
		(toolUseId: string): ParsedToolResult | undefined => toolResultMapRef.current.get(toolUseId),
		[],
	);

	// Scroll to end on initial load (Row 13: use virtual index)
	useEffect(() => {
		if (!isInitialScrollDone.current && displayEntries.length > 0 && virtuosoRef.current) {
			isInitialScrollDone.current = true;
			setTimeout(() => {
				virtuosoRef.current?.scrollToIndex({
					index: firstItemIndex + displayEntries.length - 1,
					align: 'end',
					behavior: 'auto',
				});
			}, 50);
		}
	}, [displayEntries.length, firstItemIndex]);

	// Reset initial scroll flag on session change
	// biome-ignore lint/correctness/useExhaustiveDependencies: session.id intentionally triggers reset
	useEffect(() => {
		isInitialScrollDone.current = false;
		isAtBottomRef.current = true;
		prevEntriesLength.current = 0;
		setIsPaused(false);
		setAnchorEntryId(null);
		pendingAnchorRestore.current = false;
	}, [session.id]);

	// Restore anchor position after refresh completes (Row 13: use virtual index)
	useEffect(() => {
		if (!pendingAnchorRestore.current || !anchorEntryId || displayEntries.length === 0) return;

		const anchorIndex = displayEntries.findIndex((e) => e.id === anchorEntryId);
		if (anchorIndex >= 0) {
			virtuosoRef.current?.scrollToIndex({
				index: firstItemIndex + anchorIndex,
				align: 'start',
				behavior: 'auto',
			});
		}
		pendingAnchorRestore.current = false;
		setAnchorEntryId(null);
	}, [displayEntries, anchorEntryId, firstItemIndex]);

	// Capture anchor before refresh and trigger onRefresh
	// Row 13: visibleStartIndexRef is a virtual index, convert to array index
	const handleRefreshWithAnchor = useCallback(() => {
		// Capture the first visible entry ID as anchor using tracked range
		if (displayEntries.length > 0) {
			const virtualTopIndex = visibleStartIndexRef.current;
			const arrayIndex = virtualTopIndex - firstItemIndex;
			const topEntry = displayEntries[arrayIndex];
			if (topEntry) {
				setAnchorEntryId(topEntry.id);
				pendingAnchorRestore.current = true;
			}
		}
		onRefresh();
	}, [displayEntries, onRefresh, firstItemIndex]);

	// Pause/resume progressive loading based on scroll position
	const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
		isAtBottomRef.current = atBottom;
		setIsPaused(!atBottom);
	}, []);

	// Track visible range to detect if user scrolled up and capture anchor position
	// Row 13: range indices are virtual, so compare against virtual end index
	const handleRangeChange = useCallback(
		(range: { startIndex: number; endIndex: number }) => {
			visibleStartIndexRef.current = range.startIndex;
			const virtualEndIndex = firstItemIndex + displayEntries.length - 1;
			const atBottom = range.endIndex >= virtualEndIndex - 5;
			setIsPaused(!atBottom);
		},
		[displayEntries.length, firstItemIndex],
	);

	// Progressive loading: load more when at bottom and has more
	useEffect(() => {
		if (hasMore && !isPaused && !isLoading) {
			onLoadMore();
		}
	}, [hasMore, isPaused, isLoading, onLoadMore]);

	// Snap to bottom after progressive loading adds content (Row 13: use virtual index)
	useEffect(() => {
		const currentLength = displayEntries.length;
		const hadNewEntries = currentLength > prevEntriesLength.current;
		prevEntriesLength.current = currentLength;

		// Only snap to bottom if user is CURRENTLY at bottom (not where they were when loading started)
		if (hadNewEntries && isAtBottomRef.current && currentLength > 0) {
			// Small delay to let Virtuoso measure the new content
			setTimeout(() => {
				virtuosoRef.current?.scrollToIndex({
					index: firstItemIndex + currentLength - 1,
					align: 'end',
					behavior: 'auto',
				});
			}, 50);
		}
	}, [displayEntries.length, firstItemIndex]);

	// Scroll to bottom within Archive (for new entries badge) (Row 13: use virtual index)
	const handleScrollToBottom = useCallback(() => {
		virtuosoRef.current?.scrollToIndex({
			index: firstItemIndex + displayEntries.length - 1,
			align: 'end',
			behavior: 'smooth',
		});
	}, [displayEntries.length, firstItemIndex]);

	// Compute stable key from entry ID (Row 13: account for firstItemIndex offset)
	const computeItemKey = useCallback(
		(index: number) => {
			const entry = displayEntries[index - firstItemIndex];
			return entry?.id ?? `fallback-${index}`;
		},
		[displayEntries, firstItemIndex],
	);

	// Render function for Virtuoso (Row 13: account for firstItemIndex offset)
	const itemContent = useCallback(
		(index: number) => {
			const entry = displayEntries[index - firstItemIndex];
			if (!entry) return <div style={{ height: '1px' }} />;
			return <MemoizedEntryCard entry={entry} entriesCount={displayEntries.length} />;
		},
		[displayEntries, firstItemIndex],
	);

	return (
		<div className="transcript-view archive-view-container">
			<header className="transcript-header">
				<div className="header-info">
					<span className="session-type-badge">ARCHIVE</span>
					{sessionTitle && <span className="session-title">{sessionTitle}</span>}
					<span className="session-id">{session.id}</span>
					<span className="snapshot-timestamp" title={`Snapshot from ${snapshotTimestamp}`}>
						Frozen: {formatTime(snapshotTimestamp)}
					</span>
					<span className="entry-count-indicator">
						{displayEntries.length} entries
						{hasMore && ' (loading...)'}
						{memoryWarning && ' (truncated)'}
					</span>
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
						title="Toggle thinking blocks (Shift+Alt+T)"
					>
						&#x1F4AD; Think
					</button>
					<button
						type="button"
						className={`expand-toggle ${effectiveExpandRead ? 'active' : ''}`}
						onClick={onToggleExpandRead}
						title="Toggle Read tool results"
					>
						&#x1F4D6; Read
					</button>
					<button
						type="button"
						className={`expand-toggle ${effectiveExpandEdit ? 'active' : ''}`}
						onClick={onToggleExpandEdit}
						title="Toggle Edit/Write tool results (Shift+Alt+E)"
					>
						&#x270F;&#xFE0F; Edit
					</button>
					<button
						type="button"
						className={`expand-toggle ${effectiveExpandOther ? 'active' : ''}`}
						onClick={onToggleExpandOther}
						title="Toggle other tool results (Shift+Alt+O)"
					>
						&#x1F527; Other
					</button>
				</div>
				<button
					type="button"
					className="reload-btn"
					onClick={handleRefreshWithAnchor}
					title="Refresh archive snapshot (Shift+Alt+R)"
				>
					&#x1F504;
				</button>
				<button
					type="button"
					className="auto-scroll-btn"
					onClick={onSwitchToLive}
					title="Switch to Live mode (Shift+Alt+H)"
				>
					&#x26A1;
				</button>
			</header>

			{/* Row 33: Memory warning banner */}
			{memoryWarning && (
				<div className="memory-warning-banner">
					Archive truncated to prevent memory issues. Showing last {displayEntries.length} entries.
				</div>
			)}

			<div className="entries-container">
				{isLoading && displayEntries.length === 0 ? (
					<div className="archive-loading-overlay">
						<div className="spinner" />
						{/* Row 32: Enhanced loading progress */}
						<div className="archive-progress">
							{totalCount && totalCount > 0
								? `Loading history... ${loadingProgress}% (${entries.length}/${totalCount} entries)`
								: `Loading history... ${loadingProgress}%`}
						</div>
					</div>
				) : displayEntries.length === 0 ? (
					<div className="empty-transcript">No entries in this transcript</div>
				) : (
					<EntryProvider expandState={expandState} getToolResult={getToolResult}>
						<Virtuoso
							key={session.id}
							ref={virtuosoRef}
							data={displayEntries}
							firstItemIndex={firstItemIndex}
							computeItemKey={computeItemKey}
							itemContent={itemContent}
							itemSize={fractionalItemSize}
							initialTopMostItemIndex={firstItemIndex + displayEntries.length - 1}
							followOutput={false}
							atBottomStateChange={handleAtBottomStateChange}
							atBottomThreshold={100}
							rangeChanged={handleRangeChange}
							increaseViewportBy={{ top: 200, bottom: 200 }}
							style={{ height: '100%' }}
							components={{
								Item: VirtuosoItem,
								Header: () => {
									if (!hasMore && !isLoading) return null;
									return (
										<div style={{ height: '40px', overflow: 'hidden' }}>
											{isLoading && (
												<div className="loading-older">
													Loading... {loadingProgress}%
													{isPaused && ' (paused - scroll to bottom to resume)'}
												</div>
											)}
											{!isLoading && hasMore && (
												<div className="has-more-indicator">
													{isPaused
														? 'Scroll to bottom to continue loading'
														: 'Loading more entries...'}
												</div>
											)}
										</div>
									);
								},
							}}
						/>
					</EntryProvider>
				)}
			</div>

			{/* Archive is a frozen snapshot - no "new entries" badge (only makes sense in Live mode) */}
		</div>
	);
}

// Entry card components - reused from TranscriptView pattern

interface EntryCardProps {
	entry: ParsedEntry;
	entriesCount: number;
}

const MemoizedEntryCard = memo(function EntryCard({
	entry,
	entriesCount: _entriesCount,
}: EntryCardProps) {
	const { expandState } = useEntryContext();

	switch (entry.type) {
		case 'user':
			return <MemoizedUserEntry entry={entry} />;
		case 'assistant':
			return <MemoizedAssistantEntry entry={entry} />;
		case 'tool_result':
			return <MemoizedToolResultEntry entry={entry} expanded={expandState.other} />;
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
				{entry.content && <CopyButton content={entry.content} title="Copy message" />}
			</div>
			<div className="entry-content">{entry.content && <Markdown content={entry.content} />}</div>
		</div>
	);
});

interface AssistantEntryProps {
	entry: ParsedEntry;
}

const MemoizedAssistantEntry = memo(function AssistantEntry({ entry }: AssistantEntryProps) {
	const { expandState, getToolResult } = useEntryContext();

	return (
		<>
			{entry.thinking && (
				<details className="entry thinking-entry" open={expandState.thinking}>
					<summary className="entry-header">
						<span className="role-badge thinking">THINKING</span>
						<span className="timestamp">{formatTime(entry.timestamp)}</span>
						<CopyButton content={entry.thinking} title="Copy thinking" />
					</summary>
					<pre className="entry-content thinking-content">{entry.thinking}</pre>
				</details>
			)}

			{entry.content && (
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
						<CopyButton content={entry.content} title="Copy response" />
					</div>
					<div className="entry-content">
						<Markdown content={entry.content} />
					</div>
				</div>
			)}

			{entry.toolCalls?.map((tool) => {
				const category = getToolCategory(tool.name);
				const expandGroup = getExpandGroup(category);
				const expanded =
					expandGroup === 'read'
						? expandState.read
						: expandGroup === 'edit'
							? expandState.edit
							: expandState.other;
				return (
					<MemoizedToolCallBlock
						key={tool.id}
						tool={tool}
						category={category}
						expanded={expanded}
						result={getToolResult(tool.id)}
						timestamp={entry.timestamp}
					/>
				);
			})}
		</>
	);
});

interface ToolCallBlockProps {
	tool: NonNullable<ParsedEntry['toolCalls']>[0];
	category: import('../../shared/tools.ts').ToolCategory;
	expanded: boolean;
	result?: ParsedToolResult;
	timestamp: string;
}

const TOOL_ICONS: Record<import('../../shared/tools.ts').ToolCategory, string> = {
	read: '\uD83D\uDCD6',
	edit: '\u270F\uFE0F',
	bash: '\uD83D\uDCBB',
	search: '\uD83D\uDD0D',
	web: '\uD83C\uDF10',
	task: '\uD83E\uDD16',
	mcp: '\uD83D\uDD0C',
	skill: '\u26A1',
	other: '\uD83D\uDD27',
};

const MemoizedToolCallBlock = memo(function ToolCallBlock({
	tool,
	category,
	expanded,
	result,
	timestamp,
}: ToolCallBlockProps) {
	const { summary, details } = useMemo(
		() => formatToolInput(tool.name, tool.input),
		[tool.name, tool.input],
	);

	const icon = TOOL_ICONS[category];
	const filePath = tool.input?.file_path as string | undefined;
	const isReadTool = category === 'read';
	const isBashTool = category === 'bash';
	const isEditTool = tool.name === 'Edit' || tool.name === 'MultiEdit';
	const isWriteTool = tool.name === 'Write';
	const isFileTool = isReadTool || isEditTool || isWriteTool;

	const oldString = tool.input?.old_string as string | undefined;
	const newString = tool.input?.new_string as string | undefined;
	const hasDiff = isEditTool && oldString !== undefined && newString !== undefined;

	const writeContent = tool.input?.content as string | undefined;

	return (
		<details className={`entry tool-entry tool-${category}`} open={expanded}>
			<summary className="entry-header">
				<span className={`role-badge tool-${category}`}>
					{icon} {tool.name.toUpperCase()}
				</span>
				<span className="timestamp">{formatTime(timestamp)}</span>
				{isFileTool && filePath && <span className="tool-filepath">{filePath}</span>}
				{result && (
					<span
						className={`result-indicator ${result.isError ? 'error' : 'success'}`}
						aria-label={result.isError ? 'Error' : 'Success'}
					>
						{result.isError ? ' \u274C' : ' \u2713'}
					</span>
				)}
			</summary>

			<div className="entry-content">
				{/* Tool primary info - skip for file tools (path shown in header) */}
				{!isFileTool && summary && <div className="tool-summary-body">{summary}</div>}

				{hasDiff && (
					<LazyDiffView
						oldValue={oldString}
						newValue={newString}
						filePath={filePath}
						maxHeight="400px"
					/>
				)}

				{isWriteTool && writeContent && (
					<CodeBlock
						code={writeContent}
						filePath={filePath}
						showLineNumbers={true}
						maxHeight="400px"
					/>
				)}

				{!hasDiff && !isWriteTool && details && <pre className="tool-details">{details}</pre>}

				{(hasDiff || isWriteTool) && result?.isError && (
					<div className="tool-result-error">
						<pre>{result.content}</pre>
					</div>
				)}

				{!hasDiff && !isWriteTool && result && (
					<div className={`tool-result ${result.isError ? 'error' : ''}`}>
						<div className="result-label">
							{result.isError ? '\u274C Error' : '\u2713 Result'}
							<CopyButton content={result.content} title="Copy result" />
						</div>
						{isReadTool && filePath && getLanguageFromPath(filePath) ? (
							<CodeBlock
								code={result.content}
								filePath={filePath}
								showLineNumbers={true}
								maxHeight="400px"
							/>
						) : isBashTool ? (
							<AnsiText text={result.content} className="result-content" />
						) : (
							<pre className="result-content">{result.content}</pre>
						)}
					</div>
				)}
			</div>
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
