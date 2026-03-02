import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ItemProps, Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
	formatNumber,
	formatTime,
	formatToolInput,
	stripReadLineNumbers,
} from '../../shared/formatters.ts';
import { getExpandGroup, getToolCategory } from '../../shared/tools.ts';
import type { ParsedEntry, ParsedToolResult, Session, TokenStats } from '../../types.ts';
import { useConfig } from '../ConfigContext.tsx';
import { EntryProvider, type ExpandState, useEntryContext } from '../EntryContext.tsx';
import { useTextHighlight } from '../hooks/useTextHighlight.ts';
import { useTranscriptSearch } from '../hooks/useTranscriptSearch.ts';
import { AnsiText } from './AnsiText.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { CopyButton } from './CopyButton.tsx';
import { LazyDiffView } from './LazyDiffView.tsx';
import { Markdown } from './Markdown.tsx';
import { SearchOverlay } from './SearchOverlay.tsx';

// Threshold for showing "Back to Live" floating indicator
const NEAR_BOTTOM_THRESHOLD = 500;

// Scroll the nearest scrollable ancestor to reveal matching text within an entry
function scrollToMatchText(entry: Element, queryLower: string, outerScroller: HTMLElement) {
	if (!queryLower) return;
	const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.textContent?.toLowerCase() ?? '';
		const idx = text.indexOf(queryLower);
		if (idx === -1) continue;

		const range = new Range();
		range.setStart(node, idx);
		range.setEnd(node, idx + queryLower.length);

		// Scroll inner scrollbox if match is inside one
		let parent = node.parentElement;
		while (parent && parent !== entry) {
			if (parent.scrollHeight > parent.clientHeight + 1) {
				const style = getComputedStyle(parent);
				if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
					const rangeRect = range.getBoundingClientRect();
					const parentRect = parent.getBoundingClientRect();
					if (rangeRect.top < parentRect.top || rangeRect.bottom > parentRect.bottom) {
						parent.scrollTop = rangeRect.top - parentRect.top + parent.scrollTop - 20;
					}
					break;
				}
			}
			parent = parent.parentElement;
		}

		// Scroll outer Virtuoso scroller if match is outside viewport
		const updatedRect = range.getBoundingClientRect();
		const scrollerRect = outerScroller.getBoundingClientRect();
		if (updatedRect.top < scrollerRect.top || updatedRect.bottom > scrollerRect.bottom) {
			outerScroller.scrollTop += updatedRect.top - scrollerRect.top - 100;
		}
		return;
	}
}

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
	isLoadingAll?: boolean;
	onLoadAll?: () => void;
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
	isLoadingAll = false,
	onLoadAll,
}: ArchiveViewProps) {
	const { config } = useConfig();
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const [isPaused, setIsPaused] = useState(false);
	const isAtBottomRef = useRef(true);
	const isInitialScrollDone = useRef(false);
	const prevEntriesLength = useRef(0);

	// Near-bottom detection for floating "Back to Live" indicator
	const [showBackToLive, setShowBackToLive] = useState(false);
	const scrollListenerCleanupRef = useRef<(() => void) | null>(null);
	const scrollerElRef = useRef<HTMLElement | null>(null);

	const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
		scrollListenerCleanupRef.current?.();
		scrollListenerCleanupRef.current = null;
		if (!(el instanceof HTMLElement)) {
			scrollerElRef.current = null;
			return;
		}
		scrollerElRef.current = el;
		const onScroll = () => {
			const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
			setShowBackToLive(nearBottom);
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		scrollListenerCleanupRef.current = () => el.removeEventListener('scroll', onScroll);
		requestAnimationFrame(onScroll);
	}, []);

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

	// Transcript search
	const search = useTranscriptSearch(displayEntries, getToolResult);
	useTextHighlight(scrollerElRef, search.query, search.isOpen);

	// Sync external loading state into search hook
	useEffect(() => {
		search.setIsLoadingAll(isLoadingAll);
	}, [isLoadingAll, search.setIsLoadingAll]);

	// Ctrl+F interception
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
				e.preventDefault();
				search.open();
				if (hasMore && onLoadAll) onLoadAll();
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [search.open, hasMore, onLoadAll]);

	// Navigate to search match: fast path for nearby entries, binary search for distant ones
	useEffect(() => {
		if (search.navigateCounter > 0 && search.currentEntryIndex !== null && scrollerElRef.current) {
			const el = scrollerElRef.current;
			const target = search.currentEntryIndex;
			const queryLower = search.query.toLowerCase();

			// Fast path: target already rendered in DOM (nearby/on-screen match)
			const existingMatch = el.querySelector('.search-match-current');
			if (existingMatch) {
				existingMatch.scrollIntoView({ block: 'center', behavior: 'instant' });
				requestAnimationFrame(() => scrollToMatchText(existingMatch, queryLower, el));
				return;
			}

			// Slow path: binary search with hidden content to prevent visual jitter
			el.style.visibility = 'hidden';
			let lo = 0;
			let hi = el.scrollHeight;

			el.scrollTo({
				top: (target / displayEntries.length) * hi,
				behavior: 'instant',
			});

			let attempt = 0;
			function step() {
				const match = el.querySelector('.search-match-current');
				if (match) {
					match.scrollIntoView({ block: 'center', behavior: 'instant' });
					el.style.visibility = '';
					requestAnimationFrame(() => scrollToMatchText(match, queryLower, el));
					return;
				}
				if (attempt >= 20 || hi - lo < 2) {
					el.style.visibility = '';
					return;
				}
				attempt++;

				const items = el.querySelectorAll('[data-item-index]');
				if (items.length === 0) {
					requestAnimationFrame(step);
					return;
				}

				const targetVirtual = target + firstItemIndex;
				const firstVirtual = Number.parseInt(items[0].getAttribute('data-item-index')!);

				if (targetVirtual < firstVirtual) {
					hi = el.scrollTop;
				} else {
					lo = el.scrollTop;
				}
				el.scrollTo({ top: (lo + hi) / 2, behavior: 'instant' });
				requestAnimationFrame(step);
			}
			requestAnimationFrame(step);
		}
	}, [
		search.navigateCounter,
		search.currentEntryIndex,
		search.query,
		displayEntries.length,
		firstItemIndex,
	]);

	// Disable progressive loading while loadAll is running
	const effectiveIsLoading = isLoading || isLoadingAll;

	// Scroll to end on initial load
	useEffect(() => {
		if (!isInitialScrollDone.current && displayEntries.length > 0 && scrollerElRef.current) {
			isInitialScrollDone.current = true;
			setTimeout(() => {
				scrollerElRef.current?.scrollTo({
					top: scrollerElRef.current.scrollHeight,
					behavior: 'instant',
				});
			}, 50);
		}
	}, [displayEntries.length]);

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
		if (anchorIndex >= 0 && scrollerElRef.current) {
			const fraction = anchorIndex / displayEntries.length;
			const el = scrollerElRef.current;
			el.scrollTo({ top: fraction * (el.scrollHeight - el.clientHeight), behavior: 'instant' });
		}
		pendingAnchorRestore.current = false;
		setAnchorEntryId(null);
	}, [displayEntries, anchorEntryId]);

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
		if (hasMore && !isPaused && !effectiveIsLoading) {
			onLoadMore();
		}
	}, [hasMore, isPaused, effectiveIsLoading, onLoadMore]);

	// Snap to bottom after progressive loading adds content (Row 13: use virtual index)
	// Suppressed when search is open to prevent overriding search scroll navigation
	useEffect(() => {
		const currentLength = displayEntries.length;
		const hadNewEntries = currentLength > prevEntriesLength.current;
		prevEntriesLength.current = currentLength;

		if (hadNewEntries && isAtBottomRef.current && currentLength > 0 && !search.isOpen) {
			setTimeout(() => {
				scrollerElRef.current?.scrollTo({
					top: scrollerElRef.current.scrollHeight,
					behavior: 'instant',
				});
			}, 50);
		}
	}, [displayEntries.length, search.isOpen]);

	// Keyboard navigation: Home/End/PageUp/PageDown for transcript scrolling
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;

			switch (e.key) {
				case 'Home':
					e.preventDefault();
					if (scrollerElRef.current) {
						scrollerElRef.current.scrollTo({ top: 0, behavior: 'instant' });
					}
					break;
				case 'End':
					e.preventDefault();
					if (scrollerElRef.current) {
						scrollerElRef.current.scrollTo({
							top: scrollerElRef.current.scrollHeight,
							behavior: 'instant',
						});
					}
					break;
				case 'PageUp':
					e.preventDefault();
					if (scrollerElRef.current) {
						scrollerElRef.current.scrollTo({
							top: scrollerElRef.current.scrollTop - scrollerElRef.current.clientHeight,
							behavior: 'instant',
						});
					}
					break;
				case 'PageDown':
					e.preventDefault();
					if (scrollerElRef.current) {
						scrollerElRef.current.scrollTo({
							top: scrollerElRef.current.scrollTop + scrollerElRef.current.clientHeight,
							behavior: 'instant',
						});
					}
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, []);

	// Scroll to bottom within Archive (for new entries badge)
	const handleScrollToBottom = useCallback(() => {
		scrollerElRef.current?.scrollTo({
			top: scrollerElRef.current.scrollHeight,
			behavior: 'smooth',
		});
	}, []);

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
			const arrayIdx = index - firstItemIndex;
			const entry = displayEntries[arrayIdx];
			if (!entry) return <div style={{ height: '1px' }} />;
			const isMatch = search.isOpen && search.matchSet.has(arrayIdx);
			const isCurrent = isMatch && search.currentEntryIndex === arrayIdx;
			return (
				<div
					className={`${isMatch ? 'search-match' : ''} ${isCurrent ? 'search-match-current' : ''}`}
				>
					<MemoizedEntryCard
						entry={entry}
						entriesCount={displayEntries.length}
						forceExpand={isCurrent}
					/>
				</div>
			);
		},
		[displayEntries, firstItemIndex, search.isOpen, search.matchSet, search.currentEntryIndex],
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

			{search.isOpen && (
				<SearchOverlay
					query={search.query}
					onQueryChange={search.setQuery}
					matchCount={search.matches.length}
					currentMatch={search.currentMatchIdx}
					onNext={search.nextMatch}
					onPrev={search.prevMatch}
					onClose={search.close}
					inputRef={search.inputRef}
					isLoadingAll={search.isLoadingAll}
				/>
			)}

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
							scrollerRef={handleScrollerRef}
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

			{/* Back to Live indicator (floating) - shows when near bottom */}
			{showBackToLive && (
				<button type="button" className="back-to-live-indicator" onClick={onSwitchToLive}>
					&#x26A1; Back to Live &#x2193;
				</button>
			)}
		</div>
	);
}

// Entry card components - reused from TranscriptView pattern

interface EntryCardProps {
	entry: ParsedEntry;
	entriesCount: number;
	forceExpand?: boolean;
}

const MemoizedEntryCard = memo(function EntryCard({
	entry,
	entriesCount: _entriesCount,
	forceExpand = false,
}: EntryCardProps) {
	const { expandState } = useEntryContext();

	switch (entry.type) {
		case 'user':
			return <MemoizedUserEntry entry={entry} />;
		case 'assistant':
			return <MemoizedAssistantEntry entry={entry} forceExpand={forceExpand} />;
		case 'tool_result':
			return <MemoizedToolResultEntry entry={entry} expanded={expandState.other || forceExpand} />;
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
	forceExpand?: boolean;
}

const MemoizedAssistantEntry = memo(function AssistantEntry({
	entry,
	forceExpand = false,
}: AssistantEntryProps) {
	const { expandState, getToolResult } = useEntryContext();

	return (
		<>
			{entry.thinking && (
				<details className="entry thinking-entry" open={expandState.thinking || forceExpand}>
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
					forceExpand ||
					(expandGroup === 'read'
						? expandState.read
						: expandGroup === 'edit'
							? expandState.edit
							: expandState.other);
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
				{isFileTool && filePath && (
					<span className="tool-filepath" title={summary}>
						{summary}
					</span>
				)}
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
					<ArchiveReadResultOrGeneric
						result={result}
						isReadTool={isReadTool}
						isBashTool={isBashTool}
						filePath={filePath}
					/>
				)}
			</div>
		</details>
	);
});

const ArchiveReadResultOrGeneric = memo(function ArchiveReadResultOrGeneric({
	result,
	isReadTool,
	isBashTool,
	filePath,
}: {
	result: ParsedToolResult;
	isReadTool: boolean;
	isBashTool: boolean;
	filePath?: string;
}) {
	const stripped = useMemo(
		() => (isReadTool ? stripReadLineNumbers(result.content) : null),
		[isReadTool, result.content],
	);

	return (
		<div className={`tool-result ${result.isError ? 'error' : ''}`}>
			<div className="result-label">
				{result.isError ? '\u274C Error' : '\u2713 Result'}
				{stripped && !result.isError && (
					<span className="result-meta">
						{stripped.lineCount} lines (from line {stripped.startLine})
					</span>
				)}
				<CopyButton content={result.content} title="Copy result" />
			</div>
			{isReadTool && filePath && !result.isError ? (
				<CodeBlock
					code={stripped?.content ?? result.content}
					filePath={filePath}
					showLineNumbers={true}
					startingLineNumber={stripped?.startLine ?? 1}
					maxHeight="400px"
				/>
			) : isBashTool ? (
				<AnsiText text={result.content} className="result-content" />
			) : (
				<pre className="result-content">{result.content}</pre>
			)}
		</div>
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
