import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedEntry } from '../../types.ts';
import type { UIConfig } from '../../types.ts';

// Maximum entries to keep in buffer (Row 13: cap at 100)
const MAX_ENTRIES = 100;

interface UseLiveSSEResult {
	entries: ParsedEntry[];
	isConnected: boolean;
	isReconnecting: boolean;
	retryInfo: { attempt: number; maxRetries: number } | null;
	isAtBottom: boolean;
	newEntriesCount: number;
	setIsAtBottom: (value: boolean) => void;
	jumpToBottom: () => void;
}

/**
 * Hook for managing live SSE connection and entry buffer
 *
 * Connects to /api/sessions/:id/live and manages:
 * - Entry buffer (capped at MAX_ENTRIES)
 * - Connection status with exponential backoff reconnection
 * - New entries count when not at bottom
 * - Reconnection indicator with retry info
 */
export function useLiveSSE(
	sessionId: string | null,
	config?: Pick<UIConfig, 'sseMaxRetries' | 'sseBaseDelayMs' | 'sseMaxDelayMs'>,
): UseLiveSSEResult {
	const [entries, setEntries] = useState<ParsedEntry[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxRetries: number } | null>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const [newEntriesCount, setNewEntriesCount] = useState(0);

	// SSE reconnection settings (Row 31: configurable with defaults)
	const maxRetries = config?.sseMaxRetries ?? 10;
	const baseDelayMs = config?.sseBaseDelayMs ?? 2000;
	const maxDelayMs = config?.sseMaxDelayMs ?? 30000;

	// Refs for stable callbacks
	const isAtBottomRef = useRef(true);
	const entriesRef = useRef<ParsedEntry[]>([]);

	// Keep refs in sync with state
	useEffect(() => {
		isAtBottomRef.current = isAtBottom;
	}, [isAtBottom]);

	useEffect(() => {
		entriesRef.current = entries;
	}, [entries]);

	// Update isAtBottom from scroll handler
	const handleSetIsAtBottom = useCallback((value: boolean) => {
		setIsAtBottom(value);
		if (value) {
			// Reset new entries count when user scrolls to bottom
			setNewEntriesCount(0);
		}
	}, []);

	// Jump to bottom action
	const jumpToBottom = useCallback(() => {
		setIsAtBottom(true);
		setNewEntriesCount(0);
	}, []);

	// SSE connection effect with exponential backoff (Row 31)
	useEffect(() => {
		if (!sessionId) {
			setEntries([]);
			setIsConnected(false);
			setIsReconnecting(false);
			setRetryInfo(null);
			setNewEntriesCount(0);
			return;
		}

		let eventSource: EventSource | null = null;
		let retryCount = 0;
		let retryTimeout: ReturnType<typeof setTimeout> | null = null;
		let isMounted = true;

		const connect = () => {
			if (!isMounted) return;

			eventSource = new EventSource(`/api/sessions/${sessionId}/live`);

			eventSource.onopen = () => {
				if (!isMounted) return;
				console.info(`[SSE] Connected to session ${sessionId.slice(0, 8)}...`);
				setIsConnected(true);
				setIsReconnecting(false);
				setRetryInfo(null);
				retryCount = 0;
			};

			eventSource.onmessage = (event) => {
				if (!isMounted) return;

				try {
					const data = JSON.parse(event.data);

					// Verify session ID to prevent cross-contamination
					if (data.sessionId && data.sessionId !== sessionId) {
						return;
					}

					if (data.type === 'live_start') {
						// Connection established, ready to receive entries
						setIsConnected(true);
						setIsReconnecting(false);
						setRetryInfo(null);
					} else if (data.type === 'batch' && Array.isArray(data.entries)) {
						const newEntries = data.entries as ParsedEntry[];
						if (newEntries.length === 0) return;

						// Append new entries and cap buffer at MAX_ENTRIES
						setEntries((prev) => {
							const combined = [...prev, ...newEntries];
							return combined.slice(-MAX_ENTRIES);
						});

						// Update new entries count if not at bottom
						if (!isAtBottomRef.current) {
							setNewEntriesCount((prev) => prev + newEntries.length);
						}
					} else if (data.type === 'truncated') {
						// File was truncated, clear entries
						setEntries([]);
						setNewEntriesCount(0);
					}
				} catch {
					// Parse error - ignore
				}
			};

			eventSource.onerror = (event) => {
				if (!isMounted) return;

				const readyState = eventSource?.readyState;
				const readyStateLabel =
					readyState === 0
						? 'CONNECTING'
						: readyState === 1
							? 'OPEN'
							: readyState === 2
								? 'CLOSED'
								: 'UNKNOWN';

				eventSource?.close();
				setIsConnected(false);

				retryCount++;
				// Debug logging for SSE reconnects
				console.warn(
					`[SSE] Connection error for session ${sessionId.slice(0, 8)}..., readyState=${readyStateLabel}(${readyState}), attempt ${retryCount}/${maxRetries}`,
					event,
				);

				if (retryCount > maxRetries) {
					// Give up after max retries
					console.error(`[SSE] Max retries (${maxRetries}) exceeded for session ${sessionId}`);
					setIsReconnecting(false);
					setRetryInfo(null);
					return;
				}

				// Set reconnecting state with retry info (Row 31)
				setIsReconnecting(true);
				setRetryInfo({ attempt: retryCount, maxRetries });

				// Exponential backoff
				const delay = Math.min(baseDelayMs * 2 ** (retryCount - 1), maxDelayMs);
				retryTimeout = setTimeout(connect, delay);
			};
		};

		connect();

		return () => {
			isMounted = false;
			eventSource?.close();
			setIsReconnecting(false);
			setRetryInfo(null);
			if (retryTimeout) {
				clearTimeout(retryTimeout);
			}
		};
	}, [sessionId, maxRetries, baseDelayMs, maxDelayMs]);

	// Reset state when session changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: sessionId intentionally triggers reset
	useEffect(() => {
		setEntries([]);
		setIsAtBottom(true);
		setNewEntriesCount(0);
		setIsReconnecting(false);
		setRetryInfo(null);
	}, [sessionId]);

	return {
		entries,
		isConnected,
		isReconnecting,
		retryInfo,
		isAtBottom,
		newEntriesCount,
		setIsAtBottom: handleSetIsAtBottom,
		jumpToBottom,
	};
}
