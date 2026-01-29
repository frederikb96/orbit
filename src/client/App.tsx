import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedEntry, Session, TokenStats } from '../types.ts';
import { useConfig } from './ConfigContext.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TranscriptView } from './components/TranscriptView.tsx';

export function App() {
	const { config } = useConfig();
	const [sessions, setSessions] = useState<Session[]>([]);
	const [selectedSession, setSelectedSession] = useState<Session | null>(null);
	const [entries, setEntries] = useState<ParsedEntry[]>([]);
	const [tokens, setTokens] = useState<TokenStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [transcriptLoading, setTranscriptLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Expand state for thinking/tool blocks
	const [expandThinking, setExpandThinking] = useState<boolean | null>(null);
	const [expandToolCalls, setExpandToolCalls] = useState<boolean | null>(null);

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
	const sseMaxRetries = config.sseMaxRetries;
	const sseBaseDelayMs = config.sseBaseDelayMs;
	const sseMaxDelayMs = config.sseMaxDelayMs;

	// Ref to track current session ID (prevents cross-contamination during session switches)
	const currentSessionIdRef = useRef<string | null>(null);

	// SSE connection for session list (push-based, no polling)
	useEffect(() => {
		let eventSource: EventSource | null = null;
		let retryCount = 0;
		let retryTimeout: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			eventSource = new EventSource('/api/sessions/stream');

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'sessions' && Array.isArray(data.sessions)) {
						// Only update if sessions actually changed (avoids re-renders from timestamp updates)
						setSessions((prev) => {
							if (prev.length !== data.sessions.length) return data.sessions;
							// Compare by ID and order - ignore mtime/lastSeen changes
							const changed = prev.some(
								(s, i) => s.id !== data.sessions[i]?.id || s.active !== data.sessions[i]?.active,
							);
							return changed ? data.sessions : prev;
						});
						setLoading(false);
						setError(null);
						retryCount = 0;
					}
				} catch {
					// Parse error
				}
			};

			eventSource.onerror = () => {
				eventSource?.close();
				retryCount++;

				if (retryCount > sseMaxRetries) {
					setError('Connection to server lost');
					setLoading(false);
					return;
				}

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
	}, [sseMaxRetries, sseBaseDelayMs, sseMaxDelayMs]);

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
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadTrigger intentionally triggers reconnect
	useEffect(() => {
		if (!selectedSession) {
			currentSessionIdRef.current = null;
			setEntries([]);
			setTokens(null);
			setSseError(null);
			return;
		}

		// Update ref immediately to prevent race conditions
		currentSessionIdRef.current = selectedSession.id;

		let eventSource: EventSource | null = null;
		let retryCount = 0;
		let isFirstInit = true;
		let retryTimeout: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			eventSource = new EventSource(`/api/sessions/${selectedSession.id}/stream`);

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);

					// Check against ref (not closure) to prevent cross-contamination during session switches
					if (data.sessionId && data.sessionId !== currentSessionIdRef.current) {
						return;
					}

					retryCount = 0;
					setSseError(null);

					if (data.type === 'init') {
						if (isFirstInit || data.entries.length > 0) {
							setEntries(data.entries);
							const stats = calculateTokens(data.entries);
							setTokens(stats);
						}
						isFirstInit = false;
						setTranscriptLoading(false);
					} else if (data.type === 'batch' && Array.isArray(data.entries)) {
						const newEntries = data.entries as ParsedEntry[];
						if (newEntries.length === 0) return;

						setEntries((prev) => [...prev, ...newEntries]);

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
						setEntries([]);
						setTokens(null);
					}
				} catch {
					// Parse error
				}
			};

			eventSource.onerror = () => {
				eventSource?.close();

				retryCount++;
				if (retryCount > sseMaxRetries) {
					setSseError(`Connection lost after ${sseMaxRetries} retries`);
					setTranscriptLoading(false);
					return;
				}

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
	}, [selectedSession, reloadTrigger, sseMaxRetries, sseBaseDelayMs, sseMaxDelayMs]);

	const handleSelectSession = useCallback((session: Session) => {
		setSelectedSession(session);
		setEntries([]);
		setTokens(null);
		setTranscriptLoading(true);

		// Update MRU stack: move selected session to front
		setMruStack((prev) => {
			const filtered = prev.filter((id) => id !== session.id);
			return [session.id, ...filtered];
		});
	}, []);

	const handleReload = useCallback(() => {
		setEntries([]);
		setTokens(null);
		setTranscriptLoading(true);
		setReloadTrigger((prev) => prev + 1);
	}, []);

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

	const handleToggleExpandToolCalls = useCallback(() => {
		setExpandToolCalls((prev) => (prev === null ? !config.defaultExpandToolCalls : !prev));
	}, [config.defaultExpandToolCalls]);

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
				case 't':
					e.preventDefault();
					handleToggleExpandThinking();
					break;
				case 'o':
					e.preventDefault();
					handleToggleExpandToolCalls();
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
		handleToggleExpandToolCalls,
		mruStack,
		commitMruSelection,
		handleNavigateSession,
	]);

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
						<TranscriptView
							session={selectedSession}
							sessionTitle={sessionTitles[selectedSession.id] ?? null}
							entries={entries}
							tokens={tokens}
							transcriptLoading={transcriptLoading}
							onReload={handleReload}
							expandThinking={expandThinking}
							expandToolCalls={expandToolCalls}
							onToggleExpandThinking={handleToggleExpandThinking}
							onToggleExpandToolCalls={handleToggleExpandToolCalls}
						/>
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
