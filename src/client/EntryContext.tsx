import { type ReactNode, createContext, useContext } from 'react';
import type { ParsedToolResult } from '../types.ts';

/**
 * Entry Context
 *
 * Provides shared state to entry components, eliminating prop drilling.
 * This improves memoization - entry components only re-render when
 * their own entry data changes, not when expand toggles change.
 */

export interface ExpandState {
	thinking: boolean;
	read: boolean;
	edit: boolean;
	other: boolean;
}

interface EntryContextValue {
	expandState: ExpandState;
	getToolResult: (toolUseId: string) => ParsedToolResult | undefined;
}

const EntryContext = createContext<EntryContextValue | null>(null);

interface EntryProviderProps {
	children: ReactNode;
	expandState: ExpandState;
	getToolResult: (toolUseId: string) => ParsedToolResult | undefined;
}

export function EntryProvider({ children, expandState, getToolResult }: EntryProviderProps) {
	return (
		<EntryContext.Provider value={{ expandState, getToolResult }}>{children}</EntryContext.Provider>
	);
}

export function useEntryContext(): EntryContextValue {
	const context = useContext(EntryContext);
	if (!context) {
		throw new Error('useEntryContext must be used within an EntryProvider');
	}
	return context;
}
