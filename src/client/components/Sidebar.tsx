import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../../types.ts';
import { useConfig } from '../ConfigContext.tsx';
import { useTheme } from '../hooks/useTheme.ts';

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;

interface SidebarProps {
	sessions: Session[];
	selectedSession: Session | null;
	onSelectSession: (session: Session) => void;
	onRefresh: () => void;
	width: number;
	onWidthChange: (width: number) => void;
	sessionTitles: Record<string, string | null>;
	mruCycleSession: Session | null;
}

export function Sidebar({
	sessions,
	selectedSession,
	onSelectSession,
	onRefresh,
	width,
	onWidthChange,
	sessionTitles,
	mruCycleSession,
}: SidebarProps) {
	const { config } = useConfig();
	const { theme, cycleTheme, isDark } = useTheme();
	const [isResizing, setIsResizing] = useState(false);
	const startXRef = useRef(0);
	const startWidthRef = useRef(0);

	// Compute active status client-side from mtime + threshold (live updates)
	const isSessionActive = (session: Session) =>
		Date.now() - session.mtime < config.activeThresholdMs;

	// Group sessions by active/recent
	const activeSessions = sessions.filter(isSessionActive);
	const recentSessions = sessions
		.filter((s) => !isSessionActive(s))
		.slice(0, config.recentSessionsLimit);

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
								title={sessionTitles[session.id] ?? null}
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
							title={sessionTitles[session.id] ?? null}
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

			<div
				className={`resize-handle ${isResizing ? 'active' : ''}`}
				onMouseDown={handleResizeStart}
			/>
		</aside>
	);
}

interface SessionItemProps {
	session: Session;
	title: string | null;
	isSelected: boolean;
	isActive: boolean;
	isMruPreview: boolean;
	onSelect: (session: Session) => void;
}

function SessionItem({
	session,
	title,
	isSelected,
	isActive,
	isMruPreview,
	onSelect,
}: SessionItemProps) {
	const timeAgo = formatTimeAgo(session.mtime);
	const typeIcon = session.type === 'agent' ? '\uD83E\uDD16' : '\uD83D\uDCAC';
	const shortId = session.id.slice(0, 8);
	// Prefer server-set name, then legacy title prop, then shortId
	const displayName = session.name ?? title ?? shortId;

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
			title={title ? `${title} (${session.id})` : session.id}
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
