# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Session navigation shortcuts: Shift+Alt+PageUp/PageDown (or Shift+Alt+,/.) to move between sessions

### Changed

- Session list now uses SSE push updates instead of polling (instant updates, zero polling)
- Session discovery filters by filename pattern during scan (fixes missing sessions bug)
- Incremental session updates on file changes (no full rescan)
- Removed `size` field from Session type (no longer needed)
- Agent ID validation now case-insensitive and accepts 7-8 hex chars consistently
- Session ID validation moved to single source of truth in sessions.ts (DRY)
- Debounced session list broadcasts (500ms) to reduce SSE traffic during active sessions
- Client-side smart comparison avoids re-renders when only timestamps change

### Fixed

- Session list sorting now consistent between startup and runtime (oldest→newest in Map)
- File deletions now properly remove sessions from list (handles fs.watch 'rename' events)
- SSE retry timeouts now cleaned up on component unmount (prevents orphan connections)
- Dead SSE clients now removed from Map on ping failure (prevents memory leak)

### Removed

- Removed EventBuffer class (replaced by direct event handling)
- Temporarily disabled session title polling (caused high CPU from slow csm calls)

## [0.1.0] - 2026-01-28

### Added

- Web-based transcript viewer with dark theme
- Real-time streaming via Server-Sent Events (SSE)
- Session discovery for Claude Code transcripts (sessions, agents, subagents)
- Active session indicator (modified recently)
- Pagination for large transcripts with scroll-up history loading
- CLI daemon management (start/stop/status/logs)
- Logging via journald (systemd-cat)
- Configuration file support (`~/.config/orbit/config.json`)
- Expand/collapse controls for thinking blocks and tool calls
- Inline tool results attached to their corresponding tool calls
- Resizable sidebar with drag handle
- Session title fetching via configurable command
- Keyboard shortcuts (Shift+Alt combinations)
- MRU (Most Recently Used) session switcher

### Security

- Session ID validation prevents command injection in title fetch
- File paths no longer exposed to client (server-only)
- Error logging for debugging SSE and config issues
