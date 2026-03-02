import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../../types.ts';
import { useConfig } from '../ConfigContext.tsx';
import { useTheme } from '../hooks/useTheme.ts';

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const SEARCH_DEBOUNCE_MS = 200;

interface SearchResult {
	id: string;
	name?: string;
	mtime: number;
	type: 'session' | 'agent';
}

interface SidebarProps {
	sessions: Session[];
	selectedSession: Session | null;
	onSelectSession: (session: Session) => void;
	onRefresh: () => void;
	width: number;
	onWidthChange: (width: number) => void;
	mruCycleSession: Session | null;
}

export function Sidebar({
	sessions,
	selectedSession,
	onSelectSession,
	onRefresh,
	width,
	onWidthChange,
	mruCycleSession,
}: SidebarProps) {
	const { config } = useConfig();
	const { theme, cycleTheme, isDark } = useTheme();
	const [isResizing, setIsResizing] = useState(false);
	const startXRef = useRef(0);
	const startWidthRef = useRef(0);

	// Search state
	const [searchQuery, setSearchQuery] = useState('');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [searchHighlight, setSearchHighlight] = useState(0);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const isSearchActive = searchQuery.length > 0;

	// Compute active status client-side from mtime + threshold (live updates)
	const isSessionActive = (session: Session) =>
		Date.now() - session.mtime < config.activeThresholdMs;

	// Group sessions by active/recent
	const activeSessions = sessions.filter(isSessionActive);
	const recentSessions = sessions
		.filter((s) => !isSessionActive(s))
		.slice(0, config.recentSessionsLimit);

	// Debounced search
	useEffect(() => {
		if (!searchQuery.trim()) {
			setSearchResults([]);
			setIsSearching(false);
			return;
		}

		setIsSearching(true);
		if (debounceRef.current) clearTimeout(debounceRef.current);

		debounceRef.current = setTimeout(async () => {
			try {
				const response = await fetch(
					`/api/sessions/search?q=${encodeURIComponent(searchQuery)}&limit=20`,
				);
				if (response.ok) {
					const data = await response.json();
					setSearchResults(data.results);
					setSearchHighlight(0);
				}
			} catch {
				// Network error — keep previous results
			} finally {
				setIsSearching(false);
			}
		}, SEARCH_DEBOUNCE_MS);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [searchQuery]);

	// Select a search result — activates it server-side then selects
	const handleSearchSelect = useCallback(
		async (result: SearchResult) => {
			try {
				await fetch(`/api/select-session/${result.id}`, { method: 'POST' });
			} catch {
				// Ignore — session may already be tracked
			}

			// Build a Session-shaped object for onSelectSession
			const session: Session = {
				id: result.id,
				path: '',
				type: result.type,
				lastSeen: result.mtime,
				mtime: result.mtime,
				active: false,
				name: result.name,
			};
			onSelectSession(session);
			setSearchQuery('');
		},
		[onSelectSession],
	);

	// Keyboard navigation in search results
	const handleSearchKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (!isSearchActive) return;

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSearchHighlight((prev) => Math.min(prev + 1, searchResults.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSearchHighlight((prev) => Math.max(prev - 1, 0));
			} else if (e.key === 'Enter' && searchResults.length > 0) {
				e.preventDefault();
				handleSearchSelect(searchResults[searchHighlight]);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				setSearchQuery('');
				searchInputRef.current?.blur();
			}
		},
		[isSearchActive, searchResults, searchHighlight, handleSearchSelect],
	);

	// Ctrl+K global shortcut to focus search
	useEffect(() => {
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
				e.preventDefault();
				searchInputRef.current?.focus();
			}
		};
		window.addEventListener('keydown', handleGlobalKeyDown);
		return () => window.removeEventListener('keydown', handleGlobalKeyDown);
	}, []);

	const handleResizeStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setIsResizing(true);
			startXRef.current = e.clientX;
			startWidthRef.current = width;
		},
		[width],
	);

	useEffect(() => {
		if (!isResizing) return;

		const handleMouseMove = (e: MouseEvent) => {
			const delta = e.clientX - startXRef.current;
			const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
			onWidthChange(newWidth);
		};

		const handleMouseUp = () => {
			setIsResizing(false);
		};

		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);

		return () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		};
	}, [isResizing, onWidthChange]);

	return (
		<aside className="sidebar" style={{ width }}>
			<div className="sidebar-header">
				<h1 className="logo">
					<span className="logo-icon">&#x25C9;</span>
					Orbit
				</h1>
				<div className="header-actions">
					<button
						type="button"
						className="theme-toggle"
						onClick={cycleTheme}
						title={`Theme: ${theme} (click to cycle)`}
					>
						{isDark ? '🌙' : theme === 'system' ? '💻' : '☀️'}
					</button>
					<button
						type="button"
						className="refresh-btn"
						onClick={onRefresh}
						title="Refresh sessions"
					>
						&#x21BB;
					</button>
				</div>
			</div>

			<div className="search-bar">
				<input
					ref={searchInputRef}
					type="text"
					className="search-input"
					placeholder="Search sessions... (Ctrl+K)"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					onKeyDown={handleSearchKeyDown}
				/>
				{isSearching && <span className="search-spinner" />}
			</div>

			{isSearchActive ? (
				<section className="session-group search-results">
					<h2 className="group-title">
						{searchResults.length > 0
							? `Results (${searchResults.length})`
							: isSearching
								? 'Searching...'
								: 'No matches'}
					</h2>
					<ul className="session-list">
						{searchResults.map((result, idx) => (
							<SearchResultItem
								key={result.id}
								result={result}
								isHighlighted={idx === searchHighlight}
								onSelect={handleSearchSelect}
							/>
						))}
					</ul>
				</section>
			) : (
				<>
					{activeSessions.length > 0 && (
						<section className="session-group">
							<h2 className="group-title">
								<span className="active-indicator">&#x26A1;</span>
								Active
							</h2>
							<ul className="session-list">
								{activeSessions.map((session) => (
									<SessionItem
										key={session.id}
										session={session}
										isSelected={selectedSession?.id === session.id}
										isActive={true}
										isMruPreview={mruCycleSession?.id === session.id}
										onSelect={onSelectSession}
									/>
								))}
							</ul>
						</section>
					)}

					<section className="session-group">
						<h2 className="group-title">Recent</h2>
						<ul className="session-list">
							{recentSessions.map((session) => (
								<SessionItem
									key={session.id}
									session={session}
									isSelected={selectedSession?.id === session.id}
									isActive={false}
									isMruPreview={mruCycleSession?.id === session.id}
									onSelect={onSelectSession}
								/>
							))}
						</ul>
					</section>

					{sessions.length === 0 && (
						<div className="empty-sidebar">
							<p>No sessions found</p>
						</div>
					)}
				</>
			)}

			<div
				className={`resize-handle ${isResizing ? 'active' : ''}`}
				onMouseDown={handleResizeStart}
			/>
		</aside>
	);
}

interface SearchResultItemProps {
	result: SearchResult;
	isHighlighted: boolean;
	onSelect: (result: SearchResult) => void;
}

function SearchResultItem({ result, isHighlighted, onSelect }: SearchResultItemProps) {
	const timeAgo = formatTimeAgo(result.mtime);
	const shortId = result.id.slice(0, 8);
	const displayName = result.name ?? shortId;

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect(result);
		}
	};

	const classNames = ['session-item', isHighlighted ? 'search-highlighted' : '']
		.filter(Boolean)
		.join(' ');

	return (
		<li
			className={classNames}
			onClick={() => onSelect(result)}
			onKeyDown={handleKeyDown}
			title={result.name ? `${result.name} (${result.id})` : result.id}
		>
			<span className="session-type">{'\uD83D\uDCAC'}</span>
			<span className="session-id">{displayName}</span>
			<span className="session-time">{timeAgo}</span>
		</li>
	);
}

interface SessionItemProps {
	session: Session;
	isSelected: boolean;
	isActive: boolean;
	isMruPreview: boolean;
	onSelect: (session: Session) => void;
}

function SessionItem({ session, isSelected, isActive, isMruPreview, onSelect }: SessionItemProps) {
	const timeAgo = formatTimeAgo(session.mtime);
	const typeIcon = session.type === 'agent' ? '\uD83E\uDD16' : '\uD83D\uDCAC';
	const shortId = session.id.slice(0, 8);
	const displayName = session.name ?? shortId;

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect(session);
		}
	};

	const classNames = [
		'session-item',
		isSelected ? 'selected' : '',
		isActive ? 'active' : '',
		isMruPreview ? 'mru-preview' : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<li
			className={classNames}
			onClick={() => onSelect(session)}
			onKeyDown={handleKeyDown}
			title={session.name ? `${session.name} (${session.id})` : session.id}
		>
			<span className="session-type">{typeIcon}</span>
			<span className="session-id">{displayName}</span>
			<span className="session-time">{timeAgo}</span>
		</li>
	);
}

function formatTimeAgo(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);

	if (seconds < 60) return 'now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}
