# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Remote session selection API (`POST /api/select-session/:id`) with SSE broadcast
- URL param session selection (`?session=<id>`) for direct linking
- `orbit start --foreground` flag for running under process managers (systemd, etc.)
- systemd-aware CLI: `orbit stop` redirects to systemctl when managed by systemd, `orbit status` shows management mode, `orbit logs` auto-selects correct journal source
- Graceful SIGTERM/SIGINT shutdown in foreground mode (clean SSE disconnect, PID cleanup)

### Fixed

- Sessions with many trailing progress/queue-operation lines showing "Waiting for new entries" instead of actual content — `parseTranscriptTail` now filters non-renderable entry types before applying the window limit
- `bun test` picking up tests from orbit-refs — added `bunfig.toml` with test root
- Session opening now starts at bottom instantly — removed CSS `scroll-behavior: smooth` (was animating all programmatic scrolls) and use `useLayoutEffect` for pre-paint scroll positioning
- Subagent discovery broken for new Claude Code agent ID formats (15, 17, 25 hex chars) — regex only accepted 7-8 chars
- Session list sidebar not updating — equality check only compared session IDs, ignoring mtime/name changes
- Subagents in newly created session directories invisible to watcher — @parcel/watcher misses nested dirs from recursive mkdir, now scans on directory creation + re-subscribes
- SSE reconnection resilience when Chrome window behind other apps — focus event + stale detection + infinite retries

### Added

- Home/End/PageUp/PageDown keyboard navigation in transcript views (Live and Archive)
- SSE reconnection with exponential backoff and retry info indicator (configurable via `sseMaxRetries`, `sseBaseDelayMs`, `sseMaxDelayMs`)
- Archive memory limit protection with configurable `archiveMaxEntries` (default 10,000)
- Memory warning banner when archive loading is truncated due to limit
- Loading progress percentage with entry count for large archives
- Lazy syntax highlighting via Shiki with IntersectionObserver (zero main thread blocking)
- LazyDiffView wrapper using React.lazy for deferred diff component loading
- Async highlighter utility with content-based caching (`src/client/lib/highlighter.ts`)
- EntryContext for shared entry state (eliminates prop drilling, improves memoization)
- Windowed data loading: Initial load shows last 50 entries, scroll to top loads more (instant first paint)
- Session navigation shortcuts: Shift+Alt+PageUp/PageDown (or Shift+Alt+,/.) to move between sessions
- Session names REST endpoint (`POST /api/sessions/:id/name`) with JSON file persistence (`~/.config/orbit/names.json`)
- Read tool results show line count and starting line number metadata
- Tool category system with 9 categories (read/edit/bash/search/web/task/mcp/skill/other)
- Tool category colors and icons for visual identification
- Markdown rendering for user and assistant messages (GFM support, XSS sanitization)
- Syntax highlighting for Read/Edit tool results with language detection from file path
- Language detection utilities (`src/shared/languages.ts`)
- Tests for tool categorization and language detection utilities
- Edit tool diff view with syntax highlighting (old→new comparison using react-diff-viewer)
- Split/unified diff toggle for Edit tool results
- Copy to clipboard buttons on user messages, assistant responses, thinking blocks, and tool results
- Light/dark/system theme toggle in sidebar header (persisted to localStorage)
- Flash prevention script for theme loading
- Shift+Alt+S keyboard shortcut to jump to bottom in Live view
- Markdown rendering for thinking blocks (in addition to assistant messages)

### Changed

- Code highlighting now respects theme (Shiki uses github-light for light mode, one-dark-pro for dark)
- Diff view syntax highlighting respects theme (react-syntax-highlighter switches styles)
- ReactDiffViewer respects theme (useDarkTheme prop now dynamic)

### Fixed

- "View Full History" indicator flickering when scrolling at threshold (400ms debounce)
- "New entries" banner flickering during autoscroll (400ms debounce)
- SSE connection reliability: migrated per-file watcher from `fs.watch` to `@parcel/watcher`
- SSE streams dropping silently when browser tab backgrounded (visibility-based reconnect)
- Bun idle timeout too aggressive for long-lived SSE connections (30s → 255s max)
- Race condition in SSE handler when client disconnects during async watcher setup
- Read tool display: stripped duplicate `cat -n` line numbers, proper CodeBlock rendering for all Read results
- Tool description truncation now responsive (fills available width, only truncates when window is narrow)
- Tool filepath shows full summary on hover via `title` attribute
- Session names now persist across daemon restarts via JSON file

- Visual refresh: GitHub-inspired dark theme with semantic palette (3 colors: accent, success, error)
- Removed tool category colors in favor of monochrome styling (cleaner visual hierarchy)
- Replaced hard 1px borders with surface depth (surface-0/1/2 layering)
- Increased whitespace between entries (1.5rem margin)
- Softer border-radius (12px) for entry cards
- CSS variables consolidated to semantic naming (--surface-*, --text-*, --accent/success/error)
- CodeBlock now shows raw code immediately, highlights when visible (Shiki replaces react-syntax-highlighter)
- Expand toggles now 4 categories (Think/Read/Edit/Other) instead of 2 (Think/Tools)
- Keyboard shortcuts: T=Think, R=Read, E=Edit, O=Other (was T=Think, C=Tool Calls)
- Active status computed client-side from `mtime + activeThresholdMs` (more responsive)
- Session list now uses SSE push updates instead of polling (instant updates, zero polling)
- Session discovery filters by filename pattern during scan (fixes missing sessions bug)
- Incremental session updates on file changes (no full rescan)
- Removed `size` field from Session type (no longer needed)
- Agent ID validation now case-insensitive and accepts 7-8 hex chars consistently
- Session ID validation moved to single source of truth in sessions.ts (DRY)
- Debounced session list broadcasts (500ms) to reduce SSE traffic during active sessions
- Client-side smart comparison avoids re-renders when only timestamps change

### Fixed

- Tool results now display immediately when received (React.memo cache-busting fix)
- Session list sorting now consistent between startup and runtime (oldest→newest in Map)
- File deletions now properly remove sessions from list (handles fs.watch 'rename' events)
- SSE retry timeouts now cleaned up on component unmount (prevents orphan connections)
- Dead SSE clients now removed from Map on ping failure (prevents memory leak)
- Keyboard shortcut conflict: Shift+Alt+R now only reloads transcript (was also toggling Read expansion)
- CLI PID tracking: server writes its own PID (fixes `orbit stop` not stopping actual server process)
- SSE ping interval race condition (interval cleared if client disconnects during startup)
- Unnecessary session list re-renders from `active` field comparison (now client-computed only)
- Dual `activeThresholdMs` config consolidated to `ui.activeThresholdMs` only

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
