import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ItemProps, Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { formatNumber, formatTime, formatToolInput } from '../../shared/formatters.ts';
import { getLanguageFromPath } from '../../shared/languages.ts';
import { getExpandGroup, getToolCategory } from '../../shared/tools.ts';
import type { ParsedEntry, ParsedToolResult, Session, TokenStats } from '../../types.ts';
import { useConfig } from '../ConfigContext.tsx';
import { EntryProvider, type ExpandState, useEntryContext } from '../EntryContext.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { CopyButton } from './CopyButton.tsx';
import { LazyDiffView } from './LazyDiffView.tsx';
import { Markdown } from './Markdown.tsx';

// Fractional item size measurement for sub-pixel accuracy
function fractionalItemSize(element: HTMLElement) {
	return element.getBoundingClientRect().height;
}

// Large offset for stable prepending (Virtuoso pattern)
const PREPEND_OFFSET = 10_000_000;

// Context passed to Virtuoso - allows us to control index-to-item mapping
// instead of letting Virtuoso manage it via data prop (which breaks on prepend)
type VirtuosoContext = {
	displayEntries: ParsedEntry[];
	numPrepended: number;
};

// Calculate real array index from Virtuoso's virtual index
// When items prepend, firstItemIndex decreases, so virtuosoIndex + numPrepended
// maps back to the correct position in the actual array
function calculateItemIndex(virtuosoIndex: number, numPrepended: number): number {
	return virtuosoIndex + numPrepended - PREPEND_OFFSET;
}

// Item wrapper traps CSS margins, preventing measurement errors
// Using VirtuosoContext as the second generic type parameter
const VirtuosoItem = React.forwardRef<HTMLDivElement, ItemProps<unknown>>((props, ref) => (
	<div {...props} ref={ref} style={{ display: 'inline-block', width: '100%' }} />
));

interface TranscriptViewProps {
	session: Session;
	sessionTitle: string | null;
	entries: ParsedEntry[];
	tokens: TokenStats | null;
	transcriptLoading: boolean;
	onReload: () => void;
	expandThinking: boolean | null;
	expandRead: boolean | null;
	expandEdit: boolean | null;
	expandOther: boolean | null;
	onToggleExpandThinking: () => void;
	onToggleExpandRead: () => void;
	onToggleExpandEdit: () => void;
	onToggleExpandOther: () => void;
	// Windowed loading
	hasMore: boolean;
	isLoadingOlder: boolean;
	numPrepended: number;
	onLoadOlder: () => void;
}

export function TranscriptView({
	session,
	sessionTitle,
	entries,
	tokens,
	transcriptLoading,
	onReload,
	expandThinking,
	expandRead,
	expandEdit,
	expandOther,
	onToggleExpandThinking,
	onToggleExpandRead,
	onToggleExpandEdit,
	onToggleExpandOther,
	hasMore,
	isLoadingOlder,
	numPrepended,
	onLoadOlder,
}: TranscriptViewProps) {
	const { config } = useConfig();
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const isAtBottomRef = useRef(true);
	const [shouldAutoscroll, setShouldAutoscroll] = useState(true);
	const [hasNewEntries, setHasNewEntries] = useState(false);

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
	// Tool results are never displayed as separate entries - they appear inline in ToolCallBlock
	// This makes displayEntries strictly append-only (critical for Virtuoso stability)
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

	// Track if this is the initial load for a session
	const isInitialLoadRef = useRef(true);

	// NOTE: Removed manual scroll adjustment - testing if Virtuoso's native
	// firstItemIndex handling works correctly when we don't interfere

	// Reset state on session change
	// biome-ignore lint/correctness/useExhaustiveDependencies: session.id intentionally triggers reset
	useEffect(() => {
		setShouldAutoscroll(true);
		setHasNewEntries(false);
		isAtBottomRef.current = true;
		isInitialLoadRef.current = true;
	}, [session.id]);

	// Scroll to bottom when entries first load for a new session
	useEffect(() => {
		if (isInitialLoadRef.current && displayEntries.length > 0 && virtuosoRef.current) {
			isInitialLoadRef.current = false;
			// Small delay to let Virtuoso finish rendering
			setTimeout(() => {
				virtuosoRef.current?.scrollToIndex({
					index: displayEntries.length - 1,
					align: 'end',
					behavior: 'auto',
				});
			}, 50);
		}
	}, [displayEntries.length]);

	// Track at-bottom state for auto-scroll decisions
	const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
		isAtBottomRef.current = atBottom;
		if (atBottom) {
			setHasNewEntries(false);
			setShouldAutoscroll(true);
		}
	}, []);

	// Load older entries when at top (stream-chat-react pattern)
	// Uses atTopStateChange instead of startReached for more reliable triggering
	const handleAtTopStateChange = useCallback(
		(isAtTop: boolean) => {
			if (isAtTop && hasMore && !isLoadingOlder) {
				onLoadOlder();
			}
		},
		[hasMore, isLoadingOlder, onLoadOlder],
	);

	// Virtuoso followOutput: auto-scroll when at bottom
	// Uses 'auto' (instant scroll) instead of 'smooth' for high-throughput SSE updates
	// to prevent visible animation causing layout shifts
	const followOutput = useCallback(
		(isAtBottom: boolean) => {
			if (!shouldAutoscroll) return false;
			if (!isAtBottom) {
				setHasNewEntries(true);
				return false;
			}
			return 'auto';
		},
		[shouldAutoscroll],
	);

	// Manual autoscroll toggle (for button click)
	const handleAutoscrollToggle = useCallback(() => {
		const newValue = !shouldAutoscroll;
		setShouldAutoscroll(newValue);
		if (newValue && virtuosoRef.current && displayEntries.length > 0) {
			virtuosoRef.current.scrollToIndex({
				index: displayEntries.length - 1,
				behavior: 'smooth',
			});
			setHasNewEntries(false);
		}
	}, [shouldAutoscroll, displayEntries.length]);

	// Enable autoscroll and scroll to bottom (for keyboard shortcut)
	const handleAutoscrollEnable = useCallback(() => {
		setShouldAutoscroll(true);
		setHasNewEntries(false);
		if (virtuosoRef.current && displayEntries.length > 0) {
			virtuosoRef.current.scrollToIndex({
				index: displayEntries.length - 1,
				behavior: 'smooth',
			});
		}
	}, [displayEntries.length]);

	// Jump to newest entries (floating button)
	const handleJumpToLatest = useCallback(() => {
		if (virtuosoRef.current && displayEntries.length > 0) {
			virtuosoRef.current.scrollToIndex({
				index: displayEntries.length - 1,
				behavior: 'smooth',
			});
		}
		setHasNewEntries(false);
		setShouldAutoscroll(true);
	}, [displayEntries.length]);

	const handleReload = useCallback(() => {
		setShouldAutoscroll(true);
		setHasNewEntries(false);
		isAtBottomRef.current = true;
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

	// Memoized context for Virtuoso - changes when entries or numPrepended change
	const virtuosoContext = useMemo<VirtuosoContext>(
		() => ({ displayEntries, numPrepended }),
		[displayEntries, numPrepended],
	);

	// Compute stable key from entry ID using context
	// We control the index-to-item mapping, not Virtuoso
	const computeItemKey = useCallback(
		(virtuosoIndex: number, _data: unknown, context: VirtuosoContext) => {
			const realIndex = calculateItemIndex(virtuosoIndex, context.numPrepended);
			const entry = context.displayEntries[realIndex];
			return entry?.id ?? `fallback-${virtuosoIndex}`;
		},
		[],
	);

	// Render function for Virtuoso - uses context to map virtuosoIndex to real entry
	// This is the key pattern from stream-chat-react: we control the mapping
	const itemContent = useCallback(
		(virtuosoIndex: number, _data: unknown, context: VirtuosoContext) => {
			const realIndex = calculateItemIndex(virtuosoIndex, context.numPrepended);
			const entry = context.displayEntries[realIndex];
			if (!entry) return <div style={{ height: '1px' }} />;
			return <MemoizedEntryCard entry={entry} entriesCount={context.displayEntries.length} />;
		},
		[],
	);

	return (
		<div className="transcript-view">
			<header className="transcript-header">
				<div className="header-info">
					<span className="session-type-badge">{session.type}</span>
					{sessionTitle && <span className="session-title">{sessionTitle}</span>}
					<span className="session-id">{session.id}</span>
					{Date.now() - session.mtime < config.activeThresholdMs && (
						<span className="active-badge">&#x26A1; Active</span>
					)}
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

			<div className="entries-container">
				{transcriptLoading ? (
					<div className="loading-entries">Loading transcript...</div>
				) : displayEntries.length === 0 ? (
					<div className="empty-transcript">No entries in this transcript</div>
				) : (
					<EntryProvider expandState={expandState} getToolResult={getToolResult}>
						<Virtuoso<unknown, VirtuosoContext>
							key={session.id}
							ref={virtuosoRef}
							// totalCount + context pattern: we control index-to-item mapping
							// instead of letting Virtuoso manage it via data prop
							totalCount={displayEntries.length}
							context={virtuosoContext}
							computeItemKey={computeItemKey}
							itemContent={itemContent}
							itemSize={fractionalItemSize}
							firstItemIndex={PREPEND_OFFSET - numPrepended}
							followOutput={followOutput}
							atBottomStateChange={handleAtBottomStateChange}
							atBottomThreshold={100}
							atTopStateChange={handleAtTopStateChange}
							increaseViewportBy={{ top: 0, bottom: 200 }}
							style={{ height: '100%' }}
							components={{
								Item: VirtuosoItem,
								Header: () => {
									// Fixed height to prevent layout shifts when loading state changes
									const showContent = isLoadingOlder || hasMore;
									return (
										<div style={{ height: showContent ? '40px' : '0px', overflow: 'hidden' }}>
											{isLoadingOlder && (
												<div className="loading-older">Loading older entries...</div>
											)}
											{!isLoadingOlder && hasMore && (
												<div className="has-more-indicator">Scroll up to load more</div>
											)}
										</div>
									);
								},
							}}
						/>
					</EntryProvider>
				)}
			</div>

			{hasNewEntries && (
				<button type="button" className="new-entries-indicator" onClick={handleJumpToLatest}>
					New entries &#x2193;
				</button>
			)}

			<footer className="transcript-footer">
				<span className="entry-count">{displayEntries.length} entries</span>
			</footer>
		</div>
	);
}

interface EntryCardProps {
	entry: ParsedEntry;
	entriesCount: number; // Busts memo when entries change (tool results arrive)
}

const MemoizedEntryCard = memo(function EntryCard({
	entry,
	entriesCount: _entriesCount, // Used to bust memo, not directly
}: EntryCardProps) {
	const { expandState } = useEntryContext();

	switch (entry.type) {
		case 'user':
			return <MemoizedUserEntry entry={entry} />;
		case 'assistant':
			return <MemoizedAssistantEntry entry={entry} />;
		case 'tool_result':
			// Tool results are filtered out in displayEntries - this is a safety fallback
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
			{/* Thinking: separate box */}
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

			{/* Assistant text: separate box */}
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

			{/* Tool calls: each is a separate box */}
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
}

// Tool category icons
const TOOL_ICONS: Record<import('../../shared/tools.ts').ToolCategory, string> = {
	read: '\uD83D\uDCD6', // 📖
	edit: '\u270F\uFE0F', // ✏️
	bash: '\uD83D\uDCBB', // 💻
	search: '\uD83D\uDD0D', // 🔍
	web: '\uD83C\uDF10', // 🌐
	task: '\uD83E\uDD16', // 🤖
	mcp: '\uD83D\uDD0C', // 🔌
	skill: '\u26A1', // ⚡
	other: '\uD83D\uDD27', // 🔧
};

const MemoizedToolCallBlock = memo(function ToolCallBlock({
	tool,
	category,
	expanded,
	result,
}: ToolCallBlockProps) {
	const { summary, details } = useMemo(
		() => formatToolInput(tool.name, tool.input),
		[tool.name, tool.input],
	);

	const icon = TOOL_ICONS[category];
	const filePath = tool.input?.file_path as string | undefined;
	const isReadTool = category === 'read';
	const isEditTool = tool.name === 'Edit' || tool.name === 'MultiEdit';
	const isWriteTool = tool.name === 'Write';

	// For Edit tool, extract old/new strings for diff view
	const oldString = tool.input?.old_string as string | undefined;
	const newString = tool.input?.new_string as string | undefined;
	const hasDiff = isEditTool && oldString !== undefined && newString !== undefined;

	// For Write tool, extract content for syntax-highlighted display
	const writeContent = tool.input?.content as string | undefined;

	return (
		<details className={`entry tool-entry tool-${category}`} open={expanded}>
			<summary className="entry-header">
				<span className={`role-badge tool-${category}`}>
					{icon} {tool.name.toUpperCase()}
				</span>
				<span className="tool-summary">{summary}</span>
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
				{/* Edit tool: show diff view from input */}
				{hasDiff && (
					<LazyDiffView
						oldValue={oldString}
						newValue={newString}
						filePath={filePath}
						maxHeight="400px"
					/>
				)}

				{/* Write tool: show syntax-highlighted content from input */}
				{isWriteTool && writeContent && (
					<CodeBlock
						code={writeContent}
						filePath={filePath}
						showLineNumbers={true}
						maxHeight="400px"
					/>
				)}

				{/* Other tools: show details */}
				{!hasDiff && !isWriteTool && details && <pre className="tool-details">{details}</pre>}

				{/* Edit/Write errors only show error message */}
				{(hasDiff || isWriteTool) && result?.isError && (
					<div className="tool-result-error">
						<pre>{result.content}</pre>
					</div>
				)}

				{/* Other tools: show full result */}
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
