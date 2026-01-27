import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedEntry, SessionInfo, TokenStats } from '../types/index.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { TranscriptView } from './components/TranscriptView.tsx';

// Max entries to keep in memory to prevent DOM overload
const MAX_ENTRIES = 300;

export function App() {
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
	const [entries, setEntries] = useState<ParsedEntry[]>([]);
	const [tokens, setTokens] = useState<TokenStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

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

	// Initial fetch and periodic refresh
	useEffect(() => {
		fetchSessions();
		const interval = setInterval(fetchSessions, 10_000); // Refresh every 10s
		return () => clearInterval(interval);
	}, [fetchSessions]);

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

	// Connect to SSE stream when session selected
	useEffect(() => {
		if (!selectedSession) {
			setEntries([]);
			setTokens(null);
			setCursor(0);
			setHasMore(false);
			return;
		}

		let eventSource: EventSource | null = null;

		const connect = () => {
			eventSource = new EventSource(`/api/sessions/${selectedSession.id}/stream`);

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);

					// Initial load (tail of transcript)
					if (data.type === 'init') {
						setEntries(data.entries);
						setCursor(data.cursor || 0);
						setHasMore(data.hasMore || false);
						// Calculate tokens from entries
						const stats = calculateTokens(data.entries);
						setTokens(stats);
					}
					// New entry - append and cap memory
					else {
						setEntries((prev) => {
							const updated = [...prev, data];
							// Cap at MAX_ENTRIES to prevent memory bloat
							if (updated.length > MAX_ENTRIES) {
								return updated.slice(-MAX_ENTRIES);
							}
							return updated;
						});
						if (data.tokens) {
							setTokens((prev) => updateTokenStats(prev, data.tokens));
						}
					}
				} catch {
					// Parse error
				}
			};

			eventSource.onerror = () => {
				eventSource?.close();
				// Reconnect after 2s
				setTimeout(connect, 2000);
			};
		};

		connect();

		return () => {
			eventSource?.close();
		};
	}, [selectedSession]);

	const handleSelectSession = (session: SessionInfo) => {
		setSelectedSession(session);
		setEntries([]);
		setTokens(null);
		setCursor(0);
		setHasMore(false);
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
					<TranscriptView
						session={selectedSession}
						entries={entries}
						tokens={tokens}
						hasMore={hasMore}
						loadingMore={loadingMore}
						onLoadMore={fetchMoreEntries}
					/>
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
