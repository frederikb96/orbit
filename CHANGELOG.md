# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-03-02

### Added

- **Session search:** Fuzzy search across ALL sessions on disk (not just tracked) by name and UUID via sidebar search bar (Ctrl+K to focus)
- **Search endpoint:** `GET /api/sessions/search?q=<query>` for full-disk session discovery with fuzzy scoring
- **On-demand session activation:** `select-session` API now activates untracked sessions automatically, making Kitty shortcut (Shift+Alt+K) work for any historical session
- **In-transcript search:** Ctrl+F opens floating search overlay in both Live and Archive views — searches entry content, thinking blocks, tool calls, and tool results with match navigation (Enter/Shift+Enter) and entry-level highlighting
- **Full transcript load on search:** Archive view automatically loads all remaining entries when search opens, enabling complete transcript search
- **In-text search highlighting:** CSS Custom Highlight API overlays gold highlights on matching text within visible entries, with MutationObserver for Virtuoso DOM recycling
- **Binary search scroll navigation:** Converges to exact entry position in Archive view regardless of variable item heights (replaces broken Virtuoso `scrollToIndex`)
- **Auto-expand on search:** Current search match auto-expands collapsed thinking blocks, tool calls, and tool results
- **Scroll-within-entry:** Search navigation scrolls inner scrollboxes (code blocks, tool results) and outer viewport to reveal matching text

### Fixed

- **Search scroll jitter:** Two-tier navigation eliminates scrollbar bouncing — fast path (DOM check) for nearby matches, `visibility:hidden` binary search with `requestAnimationFrame` for distant matches

## [0.2.0] - 2026-03-02

### Added

- **Dual-mode viewing:** Live mode (streaming) and Archive mode (frozen snapshot with Virtuoso virtualization)
- **Markdown rendering** for user messages, assistant responses, and thinking blocks (GFM, XSS sanitization)
- **Syntax highlighting** via Shiki with lazy IntersectionObserver loading (zero main thread blocking)
- **Edit tool diff view** with old→new comparison, split/unified toggle
- **Tool category system** with 9 categories (read/edit/bash/search/web/task/mcp/skill/other) and icons
- **Copy to clipboard** buttons on messages, responses, thinking blocks, and tool results
- **Light/dark/system theme** toggle in sidebar header (persisted to localStorage)
- **Keyboard navigation:** Home/End/PageUp/PageDown in transcript views, Shift+Alt+S jump to bottom
- **Session navigation:** Shift+Alt+PageUp/PageDown (or ,/.) to move between sessions
- **Windowed data loading:** Initial load shows last 50 entries, scroll to top loads older entries
- **Archive memory limit** with configurable `archiveMaxEntries` (default 10,000) and warning banner
- **SSE reconnection** with exponential backoff, retry indicator, multi-layer recovery (focus/resume/visibility)
- **Session names** REST endpoint (`POST /api/sessions/:id/name`) with JSON file persistence
- **Remote session selection** API (`POST /api/select-session/:id`) with SSE broadcast
- **URL param session selection** (`?session=<id>`) for direct linking
- **systemd support:** `orbit start --foreground` flag, systemd-aware stop/status/logs
- **Graceful shutdown** in foreground mode (SIGTERM/SIGINT with clean SSE disconnect)
- Read tool results show line count and starting line number metadata
- Language detection utilities for file-based syntax highlighting
- Tests for tool categorization, language detection, and V3 API

### Changed

- Visual refresh: GitHub-inspired dark theme with semantic palette (accent, success, error)
- Surface depth layering replaces hard borders (surface-0/1/2)
- CodeBlock shows raw code immediately, highlights when visible (Shiki replaces react-syntax-highlighter)
- Expand toggles: 4 categories (Think/Read/Edit/Other) instead of 2 (Think/Tools)
- Session list uses SSE push updates instead of polling (instant updates, zero polling)
- Session discovery: incremental updates on file changes, filename pattern filtering
- Active status computed client-side from `mtime + activeThresholdMs`
- Agent ID validation accepts 7+ hex chars (supports new Claude Code formats)
- Session ID validation centralized in sessions.ts (DRY)
- Debounced session list broadcasts (500ms) to reduce SSE traffic
- Code/diff highlighting respects current theme

### Fixed

- Sessions with trailing progress lines showing empty transcript
- Session opening scroll: instant positioning via `useLayoutEffect` (removed CSS `scroll-behavior: smooth`)
- Subagent discovery for new Claude Code agent ID formats (15, 17, 25 hex chars)
- Subagents in newly created directories invisible to watcher (@parcel/watcher re-subscribe)
- Session list not updating when only mtime/name changed
- SSE connection reliability: migrated to `@parcel/watcher`, visibility-based reconnect
- SSE streams dropping when browser tab backgrounded
- Bun idle timeout for long-lived SSE connections (30s → 255s max)
- Race condition in SSE handler on client disconnect during async watcher setup
- Read tool display: stripped duplicate line numbers, proper CodeBlock rendering
- Tool description truncation responsive to window width
- Session names persist across daemon restarts
- Tool results display immediately (React.memo cache-busting)
- Session list sorting consistent between startup and runtime
- File deletions properly remove sessions from list
- SSE retry timeouts cleaned up on component unmount
- Dead SSE clients removed from Map on ping failure
- CLI PID tracking: server writes its own PID
- Keyboard shortcut conflict: Shift+Alt+R only reloads transcript
- `bun test` picking up tests from orbit-refs (added `bunfig.toml`)

### Removed

- EventBuffer class (replaced by direct event handling)
- Session title polling (temporarily disabled, caused high CPU)

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
