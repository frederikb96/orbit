import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedEntry, ParsedToolResult } from '../../types.ts';
import { entryMatchesQuery } from '../lib/searchTranscript.ts';

const SEARCH_DEBOUNCE_MS = 150;
const EMPTY_MATCHES: number[] = [];
const EMPTY_SET = new Set<number>();

export interface TranscriptSearchState {
	isOpen: boolean;
	query: string;
	setQuery: (q: string) => void;
	matches: number[];
	matchSet: Set<number>;
	currentMatchIdx: number;
	currentEntryIndex: number | null;
	navigateCounter: number;
	nextMatch: () => void;
	prevMatch: () => void;
	open: () => void;
	close: () => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
	isLoadingAll: boolean;
	setIsLoadingAll: (loading: boolean) => void;
}

export function useTranscriptSearch(
	displayEntries: ParsedEntry[],
	getToolResult: (id: string) => ParsedToolResult | undefined,
): TranscriptSearchState {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
	const [navigateCounter, setNavigateCounter] = useState(0);
	const [isLoadingAll, setIsLoadingAll] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// Debounce search query
	useEffect(() => {
		if (!query.trim()) {
			setDebouncedQuery('');
			return;
		}
		const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query]);

	// Compute matching entry indices (stable empty ref when inactive)
	const matches = useMemo(() => {
		if (!debouncedQuery.trim()) return EMPTY_MATCHES;
		const q = debouncedQuery.toLowerCase();
		const result: number[] = [];
		for (let i = 0; i < displayEntries.length; i++) {
			if (entryMatchesQuery(displayEntries[i], q, getToolResult)) {
				result.push(i);
			}
		}
		return result;
	}, [displayEntries, debouncedQuery, getToolResult]);

	// Set for O(1) lookup in render (stable empty ref when inactive)
	const matchSet = useMemo(
		() => (matches === EMPTY_MATCHES ? EMPTY_SET : new Set(matches)),
		[matches],
	);

	// Auto-navigate to first match when results change
	useEffect(() => {
		if (matches.length > 0) {
			setCurrentMatchIdx(0);
			setNavigateCounter((prev) => prev + 1);
		} else {
			setCurrentMatchIdx(0);
		}
	}, [matches]);

	const currentEntryIndex = matches.length > 0 ? (matches[currentMatchIdx] ?? null) : null;

	const open = useCallback(() => {
		setIsOpen(true);
		requestAnimationFrame(() => inputRef.current?.focus());
	}, []);

	const close = useCallback(() => {
		setIsOpen(false);
		setQuery('');
		setDebouncedQuery('');
		setCurrentMatchIdx(0);
	}, []);

	const nextMatch = useCallback(() => {
		if (matches.length === 0) return;
		setCurrentMatchIdx((prev) => (prev + 1) % matches.length);
		setNavigateCounter((prev) => prev + 1);
	}, [matches.length]);

	const prevMatch = useCallback(() => {
		if (matches.length === 0) return;
		setCurrentMatchIdx((prev) => (prev - 1 + matches.length) % matches.length);
		setNavigateCounter((prev) => prev + 1);
	}, [matches.length]);

	return {
		isOpen,
		query,
		setQuery,
		matches,
		matchSet,
		currentMatchIdx,
		currentEntryIndex,
		navigateCounter,
		nextMatch,
		prevMatch,
		open,
		close,
		inputRef,
		isLoadingAll,
		setIsLoadingAll,
	};
}
