import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ViewMode } from '../types.ts';

/**
 * Batches rapid state updates into single updates at most every `delay` ms.
 * Accumulates new entries between flushes to prevent rapid re-renders from SSE bursts.
 * Returns [appendFn, clearFn] - clearFn cancels pending batches (use on session switch).
 */
function useBatchedAppend<T>(
	setState: React.Dispatch<React.SetStateAction<{ entries: T[]; numPrepended: number }>>,
	delay: number,
	maxEntries: number,
): [(items: T[]) => void, () => void] {
	const pendingRef = useRef<T[]>([]);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const append = useCallback(
		(items: T[]) => {
			pendingRef.current = [...pendingRef.current, ...items];

			if (!timeoutRef.current) {
				timeoutRef.current = setTimeout(() => {
					const batch = pendingRef.current;
					pendingRef.current = [];
					timeoutRef.current = null;

					if (batch.length > 0) {
						// Append new entries with maxLiveEntries cap
						setState((prev) => {
							const combined = [...prev.entries, ...batch];
							// Cap to maxEntries (keep most recent)
							const capped = combined.length > maxEntries ? combined.slice(-maxEntries) : combined;
							return {
								...prev,
								entries: capped,
							};
						});
					}
				}, delay);
			}
		},
		[setState, delay, maxEntries],
	);

	// Clear pending batches (call on session switch to prevent contamination)
	const clear = useCallback(() => {
		pendingRef.current = [];
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

	return [append, clear];
}
import type { ParsedEntry, Session, TokenStats } from '../types.ts';
import { useConfig } from './ConfigContext.tsx';
import { ArchiveView } from './components/ArchiveView.tsx';
import { LiveView } from './components/LiveView.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TranscriptView } from './components/TranscriptView.tsx';

export function App() {
	const { config } = useConfig();
	const [sessions, setSessions] = useState<Session[]>([]);
	const [selectedSession, setSelectedSession] = useState<Session | null>(null);
	// Combined state for entries + numPrepended to ensure atomic updates
	// This prevents scroll jumps when prepending older entries (Virtuoso requires
	// firstItemIndex and data to update in the exact same render)
	const [entryState, setEntryState] = useState<{
		entries: ParsedEntry[];
		numPrepended: number;
	}>({ entries: [], numPrepended: 0 });
	const entries = entryState.entries;
	const numPrepended = entryState.numPrepended;

	const [tokens, setTokens] = useState<TokenStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [transcriptLoading, setTranscriptLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Windowed loading state
	const [cursor, setCursor] = useState<number | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [isLoadingOlder, setIsLoadingOlder] = useState(false);

	// Expand state for thinking/tool blocks (null = use config default)
	const [expandThinking, setExpandThinking] = useState<boolean | null>(null);
	const [expandRead, setExpandRead] = useState<boolean | null>(null);
	const [expandEdit, setExpandEdit] = useState<boolean | null>(null);
	const [expandOther, setExpandOther] = useState<boolean | null>(null);

	// V3 Dual-Mode state
	const [viewMode, setViewMode] = useState<ViewMode>('live');
	const [jumpToBottomTrigger, setJumpToBottomTrigger] = useState(0);
	const [archiveSnapshotTimestamp, setArchiveSnapshotTimestamp] = useState<string>('');
	const [archiveEntries, setArchiveEntries] = useState<ParsedEntry[]>([]);
	const [archiveLoading, setArchiveLoading] = useState(false);
	const [archiveProgress, setArchiveProgress] = useState(0);
	const [archiveHasMore, setArchiveHasMore] = useState(false);
	const [archiveCursor, setArchiveCursor] = useState<string | null>(null);
	const [newEntriesSinceSnapshot, setNewEntriesSinceSnapshot] = useState(0);
	const [isSSEConnected, setIsSSEConnected] = useState(false);
	const [archiveTotalCount, setArchiveTotalCount] = useState<number>(0); // Row 32: Total entries for progress
	const [archiveMemoryWarning, setArchiveMemoryWarning] = useState(false); // Row 33: Memory limit hit
	const [archiveFirstItemIndex, setArchiveFirstItemIndex] = useState(100000); // Row 13: Virtual index offset for prepended content

	// MRU (Most Recently Used) stack: ordered list of session IDs, index 0 = most recent
	const [mruStack, setMruStack] = useState<string[]>([]);
	// MRU cycling state: index in mruStack during Shift+Alt+Q cycling (null = not cycling)
	const [mruCycleIndex, setMruCycleIndex] = useState<number | null>(null);
	// Ref to track if modifiers are held (for cycling detection)
	const mruModifiersHeldRef = useRef(false);

	// Sidebar width with localStorage persistence
	const [sidebarWidth, setSidebarWidth] = useState(() => {
		const saved = localStorage.getItem('orbit-sidebar-width');
		return saved ? Number.parseInt(saved, 10) : 260;
	});

	// Persist sidebar width to localStorage
	useEffect(() => {
		localStorage.setItem('orbit-sidebar-width', String(sidebarWidth));
	}, [sidebarWidth]);

	// Session titles fetched via bash command
	const [sessionTitles, setSessionTitles] = useState<Record<string, string | null>>({});

	// Session title fetching disabled - causes high CPU due to slow csm calls
	// TODO: Re-enable with on-demand fetching instead of polling
	// useEffect(() => {
	// 	const command = config.sessionTitleCommand;
	// 	const intervalMs = config.sessionTitleIntervalMs || 15000;
	// 	if (!command || sessions.length === 0) return;
	// 	const fetchTitles = async () => {
	// 		const sessionIds = sessions.map((s) => s.id);
	// 		const res = await fetch('/api/session-titles', { method: 'POST', ... });
	// 		...
	// 	};
	// 	fetchTitles();
	// 	const interval = setInterval(fetchTitles, intervalMs);
	// 	return () => clearInterval(interval);
	// }, [sessions, config.sessionTitleCommand, config.sessionTitleIntervalMs]);

	// SSE reconnect settings from config
	const sseBaseDelayMs = config.sseBaseDelayMs;
	const sseMaxDelayMs = config.sseMaxDelayMs;

	// SSE reconnect trigger - increment to force all SSE effects to re-run
	const [reconnectTrigger, setReconnectTrigger] = useState(0);

	// Track last SSE message time per connection for stale detection
	const lastSessionListMsgRef = useRef(Date.now());
	const lastTranscriptMsgRef = useRef(Date.now());
	const lastReconnectAtRef = useRef(0);

	// Ref to track current session ID (prevents cross-contamination during session switches)
	const currentSessionIdRef = useRef<string | null>(null);

	// Refs for entries/hasMore/cursor - used in keyboard handler to avoid re-registering on every SSE batch
	const entriesRef = useRef<ParsedEntry[]>([]);
	const hasMoreRef = useRef(false);
	const cursorRef = useRef<number | null>(null);

	// Ref for viewMode - used in keyboard handler to avoid re-registering
	const viewModeRef = useRef<ViewMode>(viewMode);

	// Keep refs in sync with state
	entriesRef.current = entries;
	hasMoreRef.current = hasMore;
	cursorRef.current = cursor;
	viewModeRef.current = viewMode;

	// Get maxLiveEntries from config
	const maxLiveEntries = config.v3?.maxLiveEntries ?? 100;

	// Batched entry append to prevent rapid re-renders from SSE bursts
	// Returns [appendFn, clearFn] - clearFn prevents contamination on session switch
	const [batchedAppendEntries, clearBatchedEntries] = useBatchedAppend(
		setEntryState,
		100,
		maxLiveEntries,
	);

	// Ref for stable access to batchedAppendEntries in SSE effect
	const batchedAppendEntriesRef = useRef(batchedAppendEntries);
	batchedAppendEntriesRef.current = batchedAppendEntries;

	// Refs for mode-switch handlers used in keyboard handler (avoids re-registering on every state change)
	const switchToArchiveRef = useRef(() => {});
	const handleSwitchToLiveRef = useRef(() => {});

	// Ref for handleSelectSession - used in SSE handler and URL param handling
	const handleSelectSessionRef = useRef<(session: Session) => void>(() => {});

	// Pending session ID from URL param (?session=X) - consumed on first session list load
	const pendingSessionSelectRef = useRef<string | null>(
		new URLSearchParams(window.location.search).get('session'),
	);

	// SSE connection for session list (push-based, no polling)
	// biome-ignore lint/correctness/useExhaustiveDependencies: reconnectTrigger intentionally triggers reconnect
	useEffect(() => {
		let eventSource: EventSource | null = null;
		let retryCount = 0;
		let retryTimeout: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			eventSource = new EventSource('/api/sessions/stream');

			eventSource.onopen = () => {
				console.info('[SSE:SessionList] Connected');
				retryCount = 0;
			};

			eventSource.onmessage = (event) => {
				lastSessionListMsgRef.current = Date.now();
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'heartbeat') return;

					// Remote session selection (from orbit-session script)
					if (data.type === 'select-session' && data.sessionId) {
						setSessions((current) => {
							const session = current.find((s) => s.id === data.sessionId);
							if (session) handleSelectSessionRef.current(session);
							return current;
						});
						return;
					}

					if (data.type === 'sessions' && Array.isArray(data.sessions)) {
						setSessions((prev) => {
							if (prev.length !== data.sessions.length) return data.sessions;
							const changed = prev.some((s, i) => {
								const n = data.sessions[i];
								return s.id !== n?.id || s.mtime !== n?.mtime || s.name !== n?.name;
							});
							return changed ? data.sessions : prev;
						});
						setLoading(false);
						setError(null);

						// Handle ?session=X URL param on first session list load
						const pending = pendingSessionSelectRef.current;
						if (pending) {
							pendingSessionSelectRef.current = null;
							const session = data.sessions.find((s: Session) => s.id === pending);
							if (session) {
								handleSelectSessionRef.current(session);
								window.history.replaceState({}, '', window.location.pathname);
							}
						}
					}
				} catch {
					// Parse error
				}
			};

			eventSource.onerror = () => {
				console.warn(`[SSE:SessionList] Error, retrying (attempt ${retryCount + 1})`);
				eventSource?.close();
				retryCount++;
				const delay = Math.min(sseBaseDelayMs * 2 ** (retryCount - 1), sseMaxDelayMs);
				retryTimeout = setTimeout(connect, delay);
			};
		};

		connect();

		return () => {
			eventSource?.close();
			if (retryTimeout) {
				clearTimeout(retryTimeout);
			}
		};
	}, [sseBaseDelayMs, sseMaxDelayMs, reconnectTrigger]);

	// Manual refresh (for retry button)
	const handleRefresh = useCallback(() => {
		setLoading(true);
		setError(null);
		// Force reconnect by triggering the useEffect
		window.location.reload();
	}, []);

	// SSE connection error state
	const [sseError, setSseError] = useState<string | null>(null);

	// Reload trigger - increment to force SSE reconnect
	const [reloadTrigger, setReloadTrigger] = useState(0);

	// Connect to SSE stream when session selected
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadTrigger/reconnectTrigger intentionally trigger reconnect
	useEffect(() => {
		if (!selectedSession) {
			currentSessionIdRef.current = null;
			setEntryState({ entries: [], numPrepended: 0 });
			setTokens(null);
			setSseError(null);
			return;
		}

		currentSessionIdRef.current = selectedSession.id;

		let eventSource: EventSource | null = null;
		let retryCount = 0;
		let isFirstInit = true;
		let retryTimeout: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			eventSource = new EventSource(`/api/sessions/${selectedSession.id}/stream`);

			eventSource.onopen = () => {
				console.info(`[SSE:Transcript] Connected to session ${selectedSession.id.slice(0, 8)}...`);
				retryCount = 0;
				setSseError(null);
				setIsSSEConnected(true);
			};

			eventSource.onmessage = (event) => {
				lastTranscriptMsgRef.current = Date.now();
				try {
					const data = JSON.parse(event.data);

					if (data.sessionId && data.sessionId !== currentSessionIdRef.current) {
						return;
					}

					if (data.type === 'heartbeat') return;

					if (data.type === 'init') {
						if (isFirstInit || data.entries.length > 0) {
							setEntryState({ entries: data.entries, numPrepended: 0 });
							const stats = calculateTokens(data.entries);
							setTokens(stats);
							setCursor(data.cursor ?? null);
							setHasMore(data.hasMore ?? false);
						}
						isFirstInit = false;
						setTranscriptLoading(false);
					} else if (data.type === 'batch' && Array.isArray(data.entries)) {
						const newEntries = data.entries as ParsedEntry[];
						if (newEntries.length === 0) return;

						batchedAppendEntriesRef.current(newEntries);
						setNewEntriesSinceSnapshot((prev) => prev + newEntries.length);

						setTokens((prev) => {
							let stats = prev;
							for (const entry of newEntries) {
								if (entry.type === 'user') {
									stats = { ...stats, turns: (stats?.turns || 0) + 1 } as typeof stats;
								}
								if (entry.tokens) {
									stats = updateTokenStats(stats, entry.tokens);
								}
							}
							return stats;
						});
					} else if (data.type === 'truncated') {
						setEntryState({ entries: [], numPrepended: 0 });
						setTokens(null);
					}
				} catch {
					// Parse error
				}
			};

			eventSource.onerror = () => {
				console.warn(
					`[SSE:Transcript] Error for ${selectedSession?.id?.slice(0, 8)}, retrying (attempt ${retryCount + 1})`,
				);
				eventSource?.close();
				setIsSSEConnected(false);
				retryCount++;
				const delay = Math.min(sseBaseDelayMs * 2 ** (retryCount - 1), sseMaxDelayMs);
				retryTimeout = setTimeout(connect, delay);
			};
		};

		connect();

		return () => {
			eventSource?.close();
			setIsSSEConnected(false);
			if (retryTimeout) {
				clearTimeout(retryTimeout);
			}
		};
	}, [selectedSession, reloadTrigger, reconnectTrigger, sseBaseDelayMs, sseMaxDelayMs]);

	const handleSelectSession = useCallback(
		(session: Session) => {
			// Clear pending batched entries to prevent contamination from old session
			clearBatchedEntries();

			setSelectedSession(session);
			setEntryState({ entries: [], numPrepended: 0 });
			setTokens(null);
			setTranscriptLoading(true);
			// Always switch to Live mode when selecting a session
			setViewMode('live');
			// Reset archive state
			setArchiveEntries([]);
			setArchiveSnapshotTimestamp('');
			setNewEntriesSinceSnapshot(0);
			setArchiveFirstItemIndex(100000);

			// Update MRU stack: move selected session to front
			setMruStack((prev) => {
				const filtered = prev.filter((id) => id !== session.id);
				return [session.id, ...filtered];
			});
		},
		[clearBatchedEntries],
	);

	// Keep ref in sync for SSE handler access
	handleSelectSessionRef.current = handleSelectSession;

	const handleReload = useCallback(() => {
		setEntryState({ entries: [], numPrepended: 0 });
		setTokens(null);
		setTranscriptLoading(true);
		setCursor(null);
		setHasMore(false);
		setReloadTrigger((prev) => prev + 1);
	}, []);

	// Multi-layer SSE recovery: focus + resume + visibilitychange
	// visibilitychange only fires on tab switch/minimize, NOT when window is behind other apps.
	// focus fires reliably when user clicks the browser window on any platform.
	// resume fires when Chrome unfreezes a frozen tab (Energy Saver, 5min background).
	useEffect(() => {
		const SSE_STALE_MS = 30_000;
		const RECONNECT_COOLDOWN_MS = 5_000;

		const forceReconnect = (reason: string) => {
			const now = Date.now();
			if (now - lastReconnectAtRef.current < RECONNECT_COOLDOWN_MS) return;
			lastReconnectAtRef.current = now;
			console.info(`[SSE] Reconnecting: ${reason}`);
			setReconnectTrigger((prev) => prev + 1);
		};

		const checkStaleAndReconnect = (reason: string) => {
			const now = Date.now();
			const oldest = Math.min(lastSessionListMsgRef.current, lastTranscriptMsgRef.current);
			if (now - oldest > SSE_STALE_MS) {
				forceReconnect(reason);
			}
		};

		const handleFocus = () => checkStaleAndReconnect('window focused, connection stale');
		const handleResume = () => forceReconnect('tab resumed from frozen state');
		const handleVisibility = () => {
			if (!document.hidden) checkStaleAndReconnect('tab became visible, connection stale');
		};

		window.addEventListener('focus', handleFocus);
		document.addEventListener('resume', handleResume);
		document.addEventListener('visibilitychange', handleVisibility);
		return () => {
			window.removeEventListener('focus', handleFocus);
			document.removeEventListener('resume', handleResume);
			document.removeEventListener('visibilitychange', handleVisibility);
		};
	}, []);

	// Load older entries (windowed loading)
	const loadOlderEntries = useCallback(async () => {
		if (!hasMore || isLoadingOlder || !selectedSession || cursor === null) return;

		setIsLoadingOlder(true);
		try {
			const response = await fetch(
				`/api/sessions/${selectedSession.id}/entries?before=${cursor}&limit=15`,
			);
			if (!response.ok) throw new Error('Failed to load older entries');

			const data = await response.json();
			const olderEntries = data.entries as ParsedEntry[];

			if (olderEntries.length > 0) {
				// Count only entries that will appear in displayEntries (non-tool_result)
				// Tool results are filtered out in TranscriptView, so numPrepended must match
				// what Virtuoso actually displays, not the raw entry count
				const displayCount = olderEntries.filter((e) => e.type !== 'tool_result').length;

				// ATOMIC update: entries + numPrepended must change together
				// This prevents scroll jumps - Virtuoso needs firstItemIndex and data
				// to update in exactly the same render cycle
				setEntryState((prev) => ({
					entries: [...olderEntries, ...prev.entries],
					numPrepended: prev.numPrepended + displayCount,
				}));

				// Update token stats for older entries
				setTokens((prev) => {
					let stats = prev;
					for (const entry of olderEntries) {
						if (entry.type === 'user') {
							stats = { ...stats, turns: (stats?.turns || 0) + 1 } as typeof stats;
						}
						if (entry.tokens) {
							stats = updateTokenStats(stats, entry.tokens);
						}
					}
					return stats;
				});
			}

			// Update pagination state
			setCursor(data.cursor ?? null);
			setHasMore(data.hasMore ?? false);
		} catch (err) {
			console.error('Failed to load older entries:', err);
		} finally {
			setIsLoadingOlder(false);
		}
	}, [hasMore, isLoadingOlder, selectedSession, cursor]);

	// Sessions are already sorted by modification time from server (newest first)
	const sortedSessions = sessions;

	// Derive the session being previewed during MRU cycling
	const mruCycleSession = useMemo(() => {
		if (mruCycleIndex === null || mruStack.length < 2) return null;
		const sessionId = mruStack[mruCycleIndex];
		return sessions.find((s) => s.id === sessionId) ?? null;
	}, [mruCycleIndex, mruStack, sessions]);

	// Toggle handlers for expand states
	const handleToggleExpandThinking = useCallback(() => {
		setExpandThinking((prev) => (prev === null ? !config.defaultExpandThinking : !prev));
	}, [config.defaultExpandThinking]);

	const handleToggleExpandRead = useCallback(() => {
		setExpandRead((prev) => (prev === null ? !config.defaultExpandRead : !prev));
	}, [config.defaultExpandRead]);

	const handleToggleExpandEdit = useCallback(() => {
		setExpandEdit((prev) => (prev === null ? !config.defaultExpandEdit : !prev));
	}, [config.defaultExpandEdit]);

	const handleToggleExpandOther = useCallback(() => {
		setExpandOther((prev) => (prev === null ? !config.defaultExpandOther : !prev));
	}, [config.defaultExpandOther]);

	// MRU cycling: commit selection when modifiers released
	const commitMruSelection = useCallback(() => {
		if (mruCycleIndex !== null && mruStack.length >= 2) {
			const sessionId = mruStack[mruCycleIndex];
			const session = sessions.find((s) => s.id === sessionId);
			if (session) {
				handleSelectSession(session);
			}
		}
		setMruCycleIndex(null);
		mruModifiersHeldRef.current = false;
	}, [mruCycleIndex, mruStack, sessions, handleSelectSession]);

	// Navigate to adjacent session in list
	const handleNavigateSession = useCallback(
		(direction: -1 | 1) => {
			if (sortedSessions.length === 0) return;

			const currentIndex = selectedSession
				? sortedSessions.findIndex((s) => s.id === selectedSession.id)
				: -1;

			let newIndex: number;
			if (currentIndex === -1) {
				// No session selected: go to first (down) or last (up)
				newIndex = direction === 1 ? 0 : sortedSessions.length - 1;
			} else {
				newIndex = currentIndex + direction;
				// Clamp to valid range
				if (newIndex < 0 || newIndex >= sortedSessions.length) return;
			}

			handleSelectSession(sortedSessions[newIndex]);
		},
		[sortedSessions, selectedSession, handleSelectSession],
	);

	// Global keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// MRU cycling: Shift+Alt+Q
			if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'q') {
				e.preventDefault();

				// Need at least 2 sessions to cycle
				if (mruStack.length < 2) return;

				mruModifiersHeldRef.current = true;

				setMruCycleIndex((prev) => {
					if (prev === null) {
						// Start cycling at index 1 (previous session)
						return 1;
					}
					// Advance to next, wrapping around
					return (prev + 1) % mruStack.length;
				});
				return;
			}

			// Other shortcuts require Shift+Alt
			if (!e.shiftKey || !e.altKey) return;

			switch (e.key.toLowerCase()) {
				case 'h':
					// Toggle between Live and Archive mode (Row 34: with scroll anchor)
					e.preventDefault();
					if (viewModeRef.current === 'live') {
						switchToArchiveRef.current();
					} else {
						handleSwitchToLiveRef.current();
					}
					break;
				case 't':
					e.preventDefault();
					handleToggleExpandThinking();
					break;
				case 'e':
					e.preventDefault();
					handleToggleExpandEdit();
					break;
				case 'o':
					e.preventDefault();
					handleToggleExpandOther();
					break;
				case 'pageup':
				case ',':
					e.preventDefault();
					handleNavigateSession(-1);
					break;
				case 'pagedown':
				case '.':
					e.preventDefault();
					handleNavigateSession(1);
					break;
				case 's':
					// Jump to bottom (enables autoscroll)
					e.preventDefault();
					setJumpToBottomTrigger((prev) => prev + 1);
					break;
			}
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			// Commit MRU selection when Shift or Alt is released
			if (mruModifiersHeldRef.current && (e.key === 'Shift' || e.key === 'Alt')) {
				commitMruSelection();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	}, [
		handleToggleExpandThinking,
		handleToggleExpandEdit,
		handleToggleExpandOther,
		mruStack,
		commitMruSelection,
		handleNavigateSession,
		// Note: entries and hasMore accessed via refs to avoid re-registering on every SSE batch
	]);

	// Row 33: Get max entries limit from config (default 10000)
	const archiveMaxEntries = config.v3?.archiveMaxEntries ?? 10_000;

	// Helper to apply memory limit to entries (Row 33)
	const applyMemoryLimit = useCallback(
		(sourceEntries: ParsedEntry[]) => {
			const totalCount = sourceEntries.length;
			const hitLimit = totalCount > archiveMaxEntries;
			const limitedEntries = hitLimit
				? sourceEntries.slice(-archiveMaxEntries) // Keep most recent entries
				: sourceEntries;
			return { limitedEntries, totalCount, hitLimit };
		},
		[archiveMaxEntries],
	);

	// V3 Mode handlers - Live→Archive switch
	const switchToArchive = useCallback(() => {
		const sourceEntries = entriesRef.current;
		const sourceHasMore = hasMoreRef.current;
		const sourceCursor = cursorRef.current;
		const { limitedEntries, totalCount, hitLimit } = applyMemoryLimit(sourceEntries);
		setArchiveSnapshotTimestamp(new Date().toISOString());
		setArchiveEntries([...limitedEntries]);
		setArchiveTotalCount(totalCount);
		setArchiveMemoryWarning(hitLimit);
		setArchiveLoading(false);
		setArchiveHasMore(sourceHasMore && !hitLimit);
		setArchiveCursor(sourceCursor !== null ? String(sourceCursor) : null);
		setNewEntriesSinceSnapshot(0);
		setArchiveFirstItemIndex(100000);
		setViewMode('archive');
	}, [applyMemoryLimit]);

	const handleSwitchToLive = useCallback(() => {
		setViewMode('live');
		setArchiveMemoryWarning(false); // Reset warning when switching back to live
	}, []);

	// Keep keyboard handler refs in sync
	switchToArchiveRef.current = switchToArchive;
	handleSwitchToLiveRef.current = handleSwitchToLive;

	const handleArchiveRefresh = useCallback(() => {
		const { limitedEntries, totalCount, hitLimit } = applyMemoryLimit(entries);
		setArchiveSnapshotTimestamp(new Date().toISOString());
		setArchiveEntries([...limitedEntries]);
		setArchiveTotalCount(totalCount);
		setArchiveMemoryWarning(hitLimit);
		setArchiveLoading(false);
		setArchiveHasMore(hasMore && !hitLimit);
		// Copy the byte cursor for loading older entries in archive mode
		setArchiveCursor(cursor !== null ? String(cursor) : null);
		setNewEntriesSinceSnapshot(0);
		setArchiveFirstItemIndex(100000); // Row 13: Reset for fresh archive
	}, [entries, hasMore, cursor, applyMemoryLimit]);

	const handleArchiveLoadMore = useCallback(async () => {
		// Row 33: Check if already at memory limit
		if (archiveEntries.length >= archiveMaxEntries) {
			setArchiveHasMore(false);
			setArchiveMemoryWarning(true);
			return;
		}

		// Check if we have a cursor and session to load from
		if (!archiveCursor || !selectedSession) {
			setArchiveHasMore(false);
			return;
		}

		// Prevent concurrent loads
		if (archiveLoading) return;

		setArchiveLoading(true);
		try {
			const byteCursor = Number.parseInt(archiveCursor, 10);
			const response = await fetch(
				`/api/sessions/${selectedSession.id}/entries?before=${byteCursor}&limit=50`,
			);
			if (!response.ok) throw new Error('Failed to load older entries');

			const data = await response.json();
			const olderEntries = data.entries as ParsedEntry[];

			if (olderEntries.length > 0) {
				// Row 13: Count only display entries (tool_result filtered out in ArchiveView)
				const displayCount = olderEntries.filter((e) => e.type !== 'tool_result').length;

				// Row 13: Decrease firstItemIndex BEFORE updating entries (for atomic Virtuoso update)
				setArchiveFirstItemIndex((prev) => prev - displayCount);

				// Prepend older entries to archive
				setArchiveEntries((prev) => {
					const combined = [...olderEntries, ...prev];
					// Apply memory limit
					if (combined.length > archiveMaxEntries) {
						setArchiveMemoryWarning(true);
						return combined.slice(-archiveMaxEntries);
					}
					return combined;
				});
				setArchiveTotalCount((prev) => prev + olderEntries.length);
			}

			// Update cursor and hasMore state
			setArchiveCursor(data.cursor !== undefined ? String(data.cursor) : null);
			setArchiveHasMore(data.hasMore ?? false);
		} catch (err) {
			console.error('Failed to load older archive entries:', err);
			setArchiveHasMore(false);
		} finally {
			setArchiveLoading(false);
		}
	}, [archiveEntries.length, archiveMaxEntries, archiveCursor, selectedSession, archiveLoading]);

	const handleJumpToBottom = useCallback(() => {
		// Reset new entries counter when jumping to bottom
		setNewEntriesSinceSnapshot(0);
	}, []);

	if (loading) {
		return (
			<div className="app loading">
				<div className="spinner" />
				<p>Loading sessions...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="app error">
				<h1>Error</h1>
				<p>{error}</p>
				<button type="button" onClick={handleRefresh}>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div className="app">
			<Sidebar
				sessions={sortedSessions}
				selectedSession={selectedSession}
				onSelectSession={handleSelectSession}
				onRefresh={handleRefresh}
				width={sidebarWidth}
				onWidthChange={setSidebarWidth}
				sessionTitles={sessionTitles}
				mruCycleSession={mruCycleSession}
			/>
			<main className="main-content">
				{selectedSession ? (
					<>
						{sseError && (
							<div className="sse-error">
								<span>{sseError}</span>
								<button
									type="button"
									onClick={() => {
										setSseError(null);
										handleReload();
									}}
								>
									Retry
								</button>
							</div>
						)}
						{config.useV3DualMode ? (
							// V3 Dual-Mode: LiveView or ArchiveView
							viewMode === 'live' ? (
								<LiveView
									sessionId={selectedSession.id}
									sessionTitle={selectedSession.name ?? sessionTitles[selectedSession.id] ?? null}
									entries={entries}
									tokens={tokens}
									isConnected={isSSEConnected}
									newEntriesCount={newEntriesSinceSnapshot}
									jumpToBottomTrigger={jumpToBottomTrigger}
									onJumpToBottom={handleJumpToBottom}
									onViewFullHistory={switchToArchive}
									expandThinking={expandThinking}
									expandRead={expandRead}
									expandEdit={expandEdit}
									expandOther={expandOther}
									onToggleExpandThinking={handleToggleExpandThinking}
									onToggleExpandRead={handleToggleExpandRead}
									onToggleExpandEdit={handleToggleExpandEdit}
									onToggleExpandOther={handleToggleExpandOther}
								/>
							) : (
								<ArchiveView
									session={selectedSession}
									sessionTitle={selectedSession.name ?? sessionTitles[selectedSession.id] ?? null}
									snapshotTimestamp={archiveSnapshotTimestamp}
									entries={archiveEntries}
									isLoading={archiveLoading}
									loadingProgress={archiveProgress}
									hasMore={archiveHasMore}
									newEntriesCount={newEntriesSinceSnapshot}
									tokens={tokens}
									totalCount={archiveTotalCount}
									memoryWarning={archiveMemoryWarning}
									firstItemIndex={archiveFirstItemIndex}
									onLoadMore={handleArchiveLoadMore}
									onRefresh={handleArchiveRefresh}
									onSwitchToLive={handleSwitchToLive}
									expandThinking={expandThinking}
									expandRead={expandRead}
									expandEdit={expandEdit}
									expandOther={expandOther}
									onToggleExpandThinking={handleToggleExpandThinking}
									onToggleExpandRead={handleToggleExpandRead}
									onToggleExpandEdit={handleToggleExpandEdit}
									onToggleExpandOther={handleToggleExpandOther}
								/>
							)
						) : (
							// Legacy TranscriptView
							<TranscriptView
								session={selectedSession}
								sessionTitle={selectedSession.name ?? sessionTitles[selectedSession.id] ?? null}
								entries={entries}
								tokens={tokens}
								transcriptLoading={transcriptLoading}
								onReload={handleReload}
								expandThinking={expandThinking}
								expandRead={expandRead}
								expandEdit={expandEdit}
								expandOther={expandOther}
								onToggleExpandThinking={handleToggleExpandThinking}
								onToggleExpandRead={handleToggleExpandRead}
								onToggleExpandEdit={handleToggleExpandEdit}
								onToggleExpandOther={handleToggleExpandOther}
								hasMore={hasMore}
								isLoadingOlder={isLoadingOlder}
								numPrepended={numPrepended}
								onLoadOlder={loadOlderEntries}
							/>
						)}
					</>
				) : (
					<div className="empty-state">
						<h2>Select a session</h2>
						<p>Choose a session from the sidebar to view its transcript</p>
					</div>
				)}
			</main>
		</div>
	);
}

function calculateTokens(entries: ParsedEntry[]): TokenStats {
	const stats: TokenStats = {
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheCreationTokens: 0,
		totalCacheReadTokens: 0,
		turns: 0,
		currentContextTokens: 0,
	};

	for (const entry of entries) {
		if (entry.type === 'user') {
			stats.turns++;
		}
		if (entry.tokens) {
			const t = entry.tokens;
			stats.totalInputTokens += t.input_tokens || 0;
			stats.totalOutputTokens += t.output_tokens || 0;
			stats.totalCacheCreationTokens += t.cache_creation_input_tokens || 0;
			stats.totalCacheReadTokens += t.cache_read_input_tokens || 0;
			stats.currentContextTokens =
				(t.input_tokens || 0) +
				(t.cache_creation_input_tokens || 0) +
				(t.cache_read_input_tokens || 0);
		}
	}

	return stats;
}

function updateTokenStats(prev: TokenStats | null, usage: ParsedEntry['tokens']): TokenStats {
	const stats = prev || {
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheCreationTokens: 0,
		totalCacheReadTokens: 0,
		turns: 0,
		currentContextTokens: 0,
	};

	if (!usage) return stats;

	return {
		...stats,
		totalInputTokens: stats.totalInputTokens + (usage.input_tokens || 0),
		totalOutputTokens: stats.totalOutputTokens + (usage.output_tokens || 0),
		totalCacheCreationTokens:
			stats.totalCacheCreationTokens + (usage.cache_creation_input_tokens || 0),
		totalCacheReadTokens: stats.totalCacheReadTokens + (usage.cache_read_input_tokens || 0),
		currentContextTokens:
			(usage.input_tokens || 0) +
			(usage.cache_creation_input_tokens || 0) +
			(usage.cache_read_input_tokens || 0),
	};
}
