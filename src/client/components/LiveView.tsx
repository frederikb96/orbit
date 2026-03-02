import React, {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	formatNumber,
	formatTime,
	formatToolInput,
	stripReadLineNumbers,
} from '../../shared/formatters.ts';
import { getExpandGroup, getToolCategory } from '../../shared/tools.ts';
import type { ParsedEntry, ParsedToolResult } from '../../types.ts';
import { useConfig } from '../ConfigContext.tsx';
import { EntryProvider, type ExpandState, useEntryContext } from '../EntryContext.tsx';
import { AnsiText } from './AnsiText.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { CopyButton } from './CopyButton.tsx';
import { LazyDiffView } from './LazyDiffView.tsx';
import { Markdown } from './Markdown.tsx';

// Auto-scroll threshold: consider "at bottom" if within 50px
const AT_BOTTOM_THRESHOLD = 50;

// Top detection threshold for "View Full History" indicator
const AT_TOP_THRESHOLD = 500;

// Debounce delay for showing indicators (prevents flickering at thresholds)
const INDICATOR_DEBOUNCE_MS = 400;

interface LiveViewProps {
	sessionId: string;
	sessionTitle: string | null;
	entries: ParsedEntry[];
	tokens: import('../../types.ts').TokenStats | null;
	isConnected: boolean;
	isReconnecting?: boolean;
	retryInfo?: { attempt: number; maxRetries: number } | null;
	newEntriesCount: number;
	jumpToBottomTrigger?: number;
	onJumpToBottom: () => void;
	onViewFullHistory: () => void;
	expandThinking: boolean | null;
	expandRead: boolean | null;
	expandEdit: boolean | null;
	expandOther: boolean | null;
	onToggleExpandThinking: () => void;
	onToggleExpandRead: () => void;
	onToggleExpandEdit: () => void;
	onToggleExpandOther: () => void;
}

/**
 * LiveView - Real-time streaming view using normal scroll semantics
 *
 * Uses nested flex pattern for Firefox compatibility (bug 1042151):
 * - Outer container: handles scroll
 * - Inner container: normal column layout (oldest at top, newest at bottom)
 *
 * Scroll behavior (standard):
 * - scrollTop = 0 shows OLDEST entries (top)
 * - scrollTop = scrollHeight - clientHeight shows NEWEST entries (bottom)
 * - "Jump to bottom" = scrollTo(scrollHeight) to show newest
 */
export function LiveView({
	sessionId,
	sessionTitle,
	entries,
	tokens,
	isConnected,
	isReconnecting = false,
	retryInfo = null,
	newEntriesCount,
	jumpToBottomTrigger = 0,
	onJumpToBottom,
	onViewFullHistory,
	expandThinking,
	expandRead,
	expandEdit,
	expandOther,
	onToggleExpandThinking,
	onToggleExpandRead,
	onToggleExpandEdit,
	onToggleExpandOther,
}: LiveViewProps) {
	const { config } = useConfig();
	const containerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	// Ref to track autoscroll state (survives re-renders, used in effects)
	const autoscrollEnabledRef = useRef(true);

	// Track initial load per session (instant scroll vs smooth for appends)
	const isInitialLoadRef = useRef(true);

	// Debounced indicator visibility (prevents flickering at thresholds)
	const [showBanner, setShowBanner] = useState(false);
	const [showTopIndicator, setShowTopIndicator] = useState(false);
	const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const topIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Effective expand states (null means use config default)
	const effectiveExpandThinking = expandThinking ?? config.defaultExpandThinking;
	const effectiveExpandRead = expandRead ?? config.defaultExpandRead;
	const effectiveExpandEdit = expandEdit ?? config.defaultExpandEdit;
	const effectiveExpandOther = expandOther ?? config.defaultExpandOther;

	// Memoized expand state object for context
	const expandState: ExpandState = useMemo(
		() => ({
			thinking: effectiveExpandThinking,
			read: effectiveExpandRead,
			edit: effectiveExpandEdit,
			other: effectiveExpandOther,
		}),
		[effectiveExpandThinking, effectiveExpandRead, effectiveExpandEdit, effectiveExpandOther],
	);

	// Build tool result map for inline display
	const toolResultMap = useMemo(() => {
		const resultMap = new Map<string, ParsedToolResult>();
		for (const entry of entries) {
			if (entry.type === 'tool_result' && entry.toolResult) {
				resultMap.set(entry.toolResult.toolUseId, entry.toolResult);
			}
		}
		return resultMap;
	}, [entries]);

	// Filter out tool_result entries (displayed inline in tool calls)
	const displayEntries = useMemo(
		() => entries.filter((entry) => entry.type !== 'tool_result'),
		[entries],
	);

	// Stable callback for looking up tool results
	const getToolResult = useCallback(
		(toolUseId: string): ParsedToolResult | undefined => toolResultMap.get(toolUseId),
		[toolResultMap],
	);

	// Handle scroll events - detect position and manage debounced indicators
	const handleScroll = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;

		// Normal scroll: scrollTop=0 is top, scrollTop=scrollHeight-clientHeight is bottom
		const atBottom =
			container.scrollTop >= container.scrollHeight - container.clientHeight - AT_BOTTOM_THRESHOLD;
		const atTop = container.scrollTop < AT_TOP_THRESHOLD;

		// Update autoscroll state based on scroll position
		autoscrollEnabledRef.current = atBottom;
		setIsAtBottom(atBottom);

		// Debounce banner visibility (bottom indicator)
		if (atBottom) {
			if (bannerTimeoutRef.current) {
				clearTimeout(bannerTimeoutRef.current);
				bannerTimeoutRef.current = null;
			}
			setShowBanner(false);
		} else if (!bannerTimeoutRef.current) {
			bannerTimeoutRef.current = setTimeout(() => {
				setShowBanner(true);
				bannerTimeoutRef.current = null;
			}, INDICATOR_DEBOUNCE_MS);
		}

		// Debounce top indicator visibility (prevents flickering at threshold)
		if (!atTop) {
			if (topIndicatorTimeoutRef.current) {
				clearTimeout(topIndicatorTimeoutRef.current);
				topIndicatorTimeoutRef.current = null;
			}
			setShowTopIndicator(false);
		} else if (!topIndicatorTimeoutRef.current) {
			topIndicatorTimeoutRef.current = setTimeout(() => {
				setShowTopIndicator(true);
				topIndicatorTimeoutRef.current = null;
			}, INDICATOR_DEBOUNCE_MS);
		}
	}, []);

	// Auto-scroll when entries change AND autoscroll is enabled
	// Initial load: useLayoutEffect with instant scroll (before paint, no visible jump)
	// Subsequent appends: smooth scroll for nice UX
	useLayoutEffect(() => {
		if (!autoscrollEnabledRef.current || !containerRef.current) return;

		if (isInitialLoadRef.current && entries.length > 0) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
			isInitialLoadRef.current = false;
		} else if (!isInitialLoadRef.current) {
			containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
		}
	}, [entries.length]);

	// Cleanup timeouts on unmount
	useEffect(() => {
		return () => {
			if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
			if (topIndicatorTimeoutRef.current) clearTimeout(topIndicatorTimeoutRef.current);
		};
	}, []);

	// Reset scroll position when session changes - scroll to bottom to show newest
	// biome-ignore lint/correctness/useExhaustiveDependencies: sessionId intentionally triggers reset
	useEffect(() => {
		// Enable autoscroll for new session
		autoscrollEnabledRef.current = true;
		isInitialLoadRef.current = true;
		setIsAtBottom(true);
		setShowBanner(false);
		setShowTopIndicator(false);
		// Clear any pending timeouts
		if (bannerTimeoutRef.current) {
			clearTimeout(bannerTimeoutRef.current);
			bannerTimeoutRef.current = null;
		}
		if (topIndicatorTimeoutRef.current) {
			clearTimeout(topIndicatorTimeoutRef.current);
			topIndicatorTimeoutRef.current = null;
		}
		// Use requestAnimationFrame since content may not be rendered yet
		requestAnimationFrame(() => {
			if (containerRef.current) {
				containerRef.current.scrollTop = containerRef.current.scrollHeight;
			}
		});
	}, [sessionId]);

	// External trigger for jump to bottom (e.g., from keyboard shortcut)
	useEffect(() => {
		if (jumpToBottomTrigger > 0 && containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
			autoscrollEnabledRef.current = true;
			setIsAtBottom(true);
			setShowBanner(false);
			if (bannerTimeoutRef.current) {
				clearTimeout(bannerTimeoutRef.current);
				bannerTimeoutRef.current = null;
			}
		}
	}, [jumpToBottomTrigger]);

	// Keyboard navigation: Home/End/PageUp/PageDown for transcript scrolling
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;

			const container = containerRef.current;
			if (!container) return;

			switch (e.key) {
				case 'Home':
					e.preventDefault();
					container.scrollTop = 0;
					autoscrollEnabledRef.current = false;
					setIsAtBottom(false);
					break;
				case 'End':
					e.preventDefault();
					container.scrollTop = container.scrollHeight;
					autoscrollEnabledRef.current = true;
					setIsAtBottom(true);
					setShowBanner(false);
					if (bannerTimeoutRef.current) {
						clearTimeout(bannerTimeoutRef.current);
						bannerTimeoutRef.current = null;
					}
					onJumpToBottom();
					break;
				case 'PageUp':
					e.preventDefault();
					container.scrollTo({
						top: container.scrollTop - container.clientHeight,
						behavior: 'smooth',
					});
					break;
				case 'PageDown':
					e.preventDefault();
					container.scrollTo({
						top: container.scrollTop + container.clientHeight,
						behavior: 'smooth',
					});
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [onJumpToBottom]);

	// Jump to bottom handler - scroll to scrollHeight to show newest entries
	const handleJumpToBottom = useCallback(() => {
		if (containerRef.current) {
			containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
		}
		// Enable autoscroll when user jumps to bottom
		autoscrollEnabledRef.current = true;
		setIsAtBottom(true);
		setShowBanner(false);
		// Clear any pending banner timeout
		if (bannerTimeoutRef.current) {
			clearTimeout(bannerTimeoutRef.current);
			bannerTimeoutRef.current = null;
		}
		onJumpToBottom();
	}, [onJumpToBottom]);

	return (
		<div className="live-view transcript-view">
			<header className="transcript-header">
				<div className="header-info">
					<span className="session-type-badge live">LIVE</span>
					{sessionTitle && <span className="session-title">{sessionTitle}</span>}
					<span className="session-id">{sessionId}</span>
					<span className="entry-count-indicator">
						{displayEntries.length} entries
						{isConnected ? '' : ' (disconnected)'}
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
					className="mode-switcher-button"
					onClick={onViewFullHistory}
					title="Switch to History mode (Shift+Alt+H)"
				>
					&#x1F4DC; History
				</button>
			</header>

			{/* Scroll container - outer */}
			<div ref={containerRef} className="live-view-container" onScroll={handleScroll}>
				{/* Normal column container - inner */}
				<div className="live-view-inner">
					{/* Entries in natural order: oldest first, newest last */}
					{displayEntries.length === 0 ? (
						<div className="empty-transcript">
							{isConnected ? 'Waiting for new entries...' : 'Connecting...'}
						</div>
					) : (
						<EntryProvider expandState={expandState} getToolResult={getToolResult}>
							{displayEntries.map((entry) => (
								<div key={entry.id} data-entry-id={entry.id}>
									<LiveEntryCard entry={entry} />
								</div>
							))}
						</EntryProvider>
					)}
				</div>
			</div>

			{/* View Full History indicator (floating) - shows when near top (debounced) */}
			{showTopIndicator && displayEntries.length > 0 && (
				<button type="button" className="view-full-history-indicator" onClick={onViewFullHistory}>
					{displayEntries.length} entries &middot; View Full History &#x2191;
				</button>
			)}

			{/* New entries indicator (floating) - shows when scrolled up (debounced) */}
			{showBanner && newEntriesCount > 0 && (
				<button type="button" className="new-entries-indicator" onClick={handleJumpToBottom}>
					{newEntriesCount} new {newEntriesCount === 1 ? 'entry' : 'entries'} &#x2193;
				</button>
			)}

			{/* Connection status indicator (Row 31: shows retry attempt info) */}
			{!isConnected && (
				<div className="connection-status disconnected">
					{isReconnecting && retryInfo
						? `Reconnecting... (${retryInfo.attempt}/${retryInfo.maxRetries})`
						: retryInfo && retryInfo.attempt >= retryInfo.maxRetries
							? 'Connection failed'
							: 'Reconnecting...'}
				</div>
			)}
		</div>
	);
}

// Entry card component for LiveView - simplified version without Virtuoso optimizations
const LiveEntryCard = memo(function LiveEntryCard({ entry }: { entry: ParsedEntry }) {
	const { expandState } = useEntryContext();

	switch (entry.type) {
		case 'user':
			return <UserEntry entry={entry} />;
		case 'assistant':
			return <AssistantEntry entry={entry} />;
		case 'tool_result':
			// Tool results are filtered out - this is a safety fallback
			return <ToolResultEntry entry={entry} expanded={expandState.other} />;
		case 'system':
			return <SystemEntry entry={entry} />;
		default:
			return null;
	}
});

const UserEntry = memo(function UserEntry({ entry }: { entry: ParsedEntry }) {
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

const AssistantEntry = memo(function AssistantEntry({ entry }: { entry: ParsedEntry }) {
	const { expandState, getToolResult } = useEntryContext();

	return (
		<>
			{/* Thinking block */}
			{entry.thinking && (
				<details className="entry thinking-entry" open={expandState.thinking}>
					<summary className="entry-header">
						<span className="role-badge thinking">THINKING</span>
						<span className="timestamp">{formatTime(entry.timestamp)}</span>
						<CopyButton content={entry.thinking} title="Copy thinking" />
					</summary>
					<div className="entry-content thinking-content">
						<Markdown content={entry.thinking} />
					</div>
				</details>
			)}

			{/* Assistant text */}
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

			{/* Tool calls */}
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
					<ToolCallBlock
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

// Tool category icons
const TOOL_ICONS: Record<import('../../shared/tools.ts').ToolCategory, string> = {
	read: '\uD83D\uDCD6', // book
	edit: '\u270F\uFE0F', // pencil
	bash: '\uD83D\uDCBB', // laptop
	search: '\uD83D\uDD0D', // magnifying glass
	web: '\uD83C\uDF10', // globe
	task: '\uD83E\uDD16', // robot
	mcp: '\uD83D\uDD0C', // plug
	skill: '\u26A1', // lightning
	other: '\uD83D\uDD27', // wrench
};

interface ToolCallBlockProps {
	tool: NonNullable<ParsedEntry['toolCalls']>[0];
	category: import('../../shared/tools.ts').ToolCategory;
	expanded: boolean;
	result?: ParsedToolResult;
	timestamp: string;
}

const ToolCallBlock = memo(function ToolCallBlock({
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

	// For Edit tool, extract old/new strings for diff view
	const oldString = tool.input?.old_string as string | undefined;
	const newString = tool.input?.new_string as string | undefined;
	const hasDiff = isEditTool && oldString !== undefined && newString !== undefined;

	// For Write tool, extract content
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
					<ReadResultOrGeneric
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

/**
 * Renders Read tool results with stripped cat -n line numbers,
 * or falls back to generic result display for other tools.
 */
const ReadResultOrGeneric = memo(function ReadResultOrGeneric({
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

	// Read tool with file path: single flat container (no nested box)
	if (isReadTool && filePath && !result.isError) {
		return (
			<div className="read-result">
				<div className="read-result-header">
					<span className="result-meta">
						{stripped ? `${stripped.lineCount} lines` : 'Result'}
						{stripped && stripped.startLine > 1 && ` (from line ${stripped.startLine})`}
					</span>
					<CopyButton content={result.content} title="Copy result" />
				</div>
				<CodeBlock
					code={stripped?.content ?? result.content}
					filePath={filePath}
					showLineNumbers={true}
					startingLineNumber={stripped?.startLine ?? 1}
					maxHeight="500px"
				/>
			</div>
		);
	}

	// Other tools: standard tool-result wrapper
	return (
		<div className={`tool-result ${result.isError ? 'error' : ''}`}>
			<div className="result-label">
				{result.isError ? '\u274C Error' : '\u2713 Result'}
				<CopyButton content={result.content} title="Copy result" />
			</div>
			{isBashTool ? (
				<AnsiText text={result.content} className="result-content" />
			) : (
				<pre className="result-content">{result.content}</pre>
			)}
		</div>
	);
});

const ToolResultEntry = memo(function ToolResultEntry({
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

const SystemEntry = memo(function SystemEntry({ entry }: { entry: ParsedEntry }) {
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
