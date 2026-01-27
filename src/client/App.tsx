import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedEntry, SessionInfo, TokenStats } from '../types/index.ts';
import { useConfig } from './ConfigContext.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TranscriptView } from './components/TranscriptView.tsx';

export function App() {
	const { config } = useConfig();
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
	const [entries, setEntries] = useState<ParsedEntry[]>([]);
	const [tokens, setTokens] = useState<TokenStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [transcriptLoading, setTranscriptLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Expand state for thinking/tool blocks
	const [expandThinking, setExpandThinking] = useState<boolean | null>(null);
	const [expandToolCalls, setExpandToolCalls] = useState<boolean | null>(null);

	// Pagination state
	const [cursor, setCursor] = useState<number>(0);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const selectedSessionRef = useRef<SessionInfo | null>(null);

	// Keep ref in sync with state for async callbacks
	useEffect(() => {
		selectedSessionRef.current = selectedSession;
	}, [selectedSession]);

	// Fetch sessions list
	const fetchSessions = useCallback(async () => {
		try {
			const res = await fetch('/api/sessions');
			if (!res.ok) throw new Error('Failed to fetch sessions');
			const data = await res.json();
			setSessions(data);
			setLoading(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
			setLoading(false);
		}
	}, []);

	// Initial fetch and periodic refresh (configurable interval)
	useEffect(() => {
		fetchSessions();
		// Poll interval from config (0 = disabled)
		if (config.sessionPollInterval > 0) {
			const interval = setInterval(fetchSessions, config.sessionPollInterval);
			return () => clearInterval(interval);
		}
	}, [fetchSessions, config.sessionPollInterval]);

	// Fetch more (older) entries when scrolling up
	const fetchMoreEntries = useCallback(async () => {
		const session = selectedSessionRef.current;
		if (!session || !hasMore || loadingMore || cursor <= 0) return;

		setLoadingMore(true);
		try {
			const res = await fetch(`/api/sessions/${session.id}/entries?limit=100&before=${cursor}`);
			if (!res.ok) throw new Error('Failed to fetch');
			const data = await res.json();

			// Prepend older entries
			setEntries((prev) => [...data.entries, ...prev]);
			setCursor(data.cursor);
			setHasMore(data.hasMore);
		} catch {
			// Fetch error - ignore
		} finally {
			setLoadingMore(false);
		}
	}, [hasMore, loadingMore, cursor]);

	// SSE reconnect constants
	const SSE_MAX_RETRIES = 10;
	const SSE_BASE_DELAY_MS = 2000;
	const SSE_MAX_DELAY_MS = 30000;

	// SSE connection error state
	const [sseError, setSseError] = useState<string | null>(null);

	// Connect to SSE stream when session selected
	useEffect(() => {
		if (!selectedSession) {
			setEntries([]);
			setTokens(null);
			setCursor(0);
			setHasMore(false);
			setSseError(null);
			return;
		}

		let eventSource: EventSource | null = null;
		let retryCount = 0;
		let isFirstInit = true; // Track first init vs reconnect

		const connect = () => {
			eventSource = new EventSource(`/api/sessions/${selectedSession.id}/stream`);

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);

					// Verify session ID matches (avoid cross-session contamination during switch)
					if (data.sessionId && data.sessionId !== selectedSession.id) {
						return;
					}

					// Reset retry count on successful message
					retryCount = 0;
					setSseError(null);

					// Initial load (tail of transcript)
					if (data.type === 'init') {
						// First init: always set entries (even if empty - shows "No entries")
						// Reconnect: only update if we have new entries (prevents flicker)
						if (isFirstInit || data.entries.length > 0) {
							setEntries(data.entries);
							const stats = calculateTokens(data.entries);
							setTokens(stats);
						}
						isFirstInit = false;
						setCursor(data.cursor || 0);
						setHasMore(data.hasMore || false);
						setTranscriptLoading(false);
					}
					// Batch of new entries (debounced from server)
					else if (data.type === 'batch' && Array.isArray(data.entries)) {
						const newEntries = data.entries as ParsedEntry[];
						if (newEntries.length === 0) return;

						// Single state update for all entries in batch
						setEntries((prev) => {
							const updated = [...prev, ...newEntries];
							const maxEntries = config.maxEntriesInMemory;
							if (maxEntries > 0 && updated.length > maxEntries) {
								return updated.slice(-maxEntries);
							}
							return updated;
						});

						// Single token stats update (reduce all entries, including turn count)
						setTokens((prev) => {
							let stats = prev;
							for (const entry of newEntries) {
								// Increment turn counter for user entries
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
					// File truncation (rotation) - reload from server
					else if (data.type === 'truncated') {
						setEntries([]);
						setTokens(null);
						setCursor(0);
						setHasMore(false);
					}
					// Legacy: single entry (backwards compatibility)
					else if (data.type !== 'init' && data.type !== 'batch' && data.type !== 'truncated') {
						setEntries((prev) => {
							const updated = [...prev, data];
							const maxEntries = config.maxEntriesInMemory;
							if (maxEntries > 0 && updated.length > maxEntries) {
								return updated.slice(-maxEntries);
							}
							return updated;
						});
						// Update tokens and turn count
						setTokens((prev) => {
							let stats = prev;
							if (data.type === 'user') {
								stats = { ...stats, turns: (stats?.turns || 0) + 1 } as typeof stats;
							}
							if (data.tokens) {
								stats = updateTokenStats(stats, data.tokens);
							}
							return stats;
						});
					}
				} catch {
					// Parse error
				}
			};

			eventSource.onerror = () => {
				eventSource?.close();

				retryCount++;
				if (retryCount > SSE_MAX_RETRIES) {
					// Max retries exceeded - show error and stop
					setSseError(`Connection lost after ${SSE_MAX_RETRIES} retries`);
					setTranscriptLoading(false);
					return;
				}

				// Exponential backoff: 2s, 4s, 8s, ... up to 30s
				const delay = Math.min(SSE_BASE_DELAY_MS * 2 ** (retryCount - 1), SSE_MAX_DELAY_MS);
				setTimeout(connect, delay);
			};
		};

		connect();

		return () => {
			eventSource?.close();
		};
	}, [selectedSession, config.maxEntriesInMemory]);

	const handleSelectSession = (session: SessionInfo) => {
		setSelectedSession(session);
		setEntries([]);
		setTokens(null);
		setCursor(0);
		setHasMore(false);
		setTranscriptLoading(true);
	};

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
				<button type="button" onClick={fetchSessions}>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div className="app">
			<Sidebar
				sessions={sessions}
				selectedSession={selectedSession}
				onSelectSession={handleSelectSession}
				onRefresh={fetchSessions}
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
										setTranscriptLoading(true);
										setSelectedSession({ ...selectedSession });
									}}
								>
									Retry
								</button>
							</div>
						)}
						<TranscriptView
							session={selectedSession}
							entries={entries}
							tokens={tokens}
							hasMore={hasMore}
							loadingMore={loadingMore}
							transcriptLoading={transcriptLoading}
							onLoadMore={fetchMoreEntries}
							expandThinking={expandThinking}
							expandToolCalls={expandToolCalls}
							onToggleExpandThinking={() =>
								setExpandThinking((prev) => (prev === null ? !config.defaultExpandThinking : !prev))
							}
							onToggleExpandToolCalls={() =>
								setExpandToolCalls((prev) =>
									prev === null ? !config.defaultExpandToolCalls : !prev,
								)
							}
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

// Helper to calculate tokens from entries
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

// Helper to update token stats
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
