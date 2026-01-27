import type React from 'react';
import type { SessionInfo } from '../../types/index.ts';

interface SidebarProps {
	sessions: SessionInfo[];
	selectedSession: SessionInfo | null;
	onSelectSession: (session: SessionInfo) => void;
	onRefresh: () => void;
}

export function Sidebar({ sessions, selectedSession, onSelectSession, onRefresh }: SidebarProps) {
	// Group sessions by active/recent
	const activeSessions = sessions.filter((s) => s.active);
	const recentSessions = sessions.filter((s) => !s.active).slice(0, 20);

	return (
		<aside className="sidebar">
			<div className="sidebar-header">
				<h1 className="logo">
					<span className="logo-icon">◉</span>
					Orbit
				</h1>
				<button type="button" className="refresh-btn" onClick={onRefresh} title="Refresh sessions">
					↻
				</button>
			</div>

			{activeSessions.length > 0 && (
				<section className="session-group">
					<h2 className="group-title">
						<span className="active-indicator">⚡</span>
						Active
					</h2>
					<ul className="session-list">
						{activeSessions.map((session) => (
							<SessionItem
								key={session.id}
								session={session}
								isSelected={selectedSession?.id === session.id}
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
		</aside>
	);
}

interface SessionItemProps {
	session: SessionInfo;
	isSelected: boolean;
	onSelect: (session: SessionInfo) => void;
}

function SessionItem({ session, isSelected, onSelect }: SessionItemProps) {
	const timeAgo = formatTimeAgo(session.mtime);
	const typeIcon = session.type === 'agent' ? '🤖' : '💬';
	const shortId = session.id.slice(0, 8);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect(session);
		}
	};

	return (
		<li
			className={`session-item ${isSelected ? 'selected' : ''} ${session.active ? 'active' : ''}`}
			onClick={() => onSelect(session)}
			onKeyDown={handleKeyDown}
		>
			<span className="session-type">{typeIcon}</span>
			<span className="session-id">{shortId}</span>
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
