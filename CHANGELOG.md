# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Configuration file support (`~/.config/orbit/config.json`)
  - `defaultExpandThinking`: auto-expand thinking blocks
  - `defaultExpandToolCalls`: auto-expand tool calls
  - `maxEntriesInMemory`: limit entries in browser (0 = unlimited)
  - `maxSessions`: limit sessions in sidebar (default: 10)
  - `sessionPollInterval`: client refresh interval in ms (default: 60000)
- Health check endpoint (`/api/health`) for reliable startup detection
- Config endpoint (`/api/config`) for client settings
- Toggle buttons in header for expand all thinking/tools
- Visual entry backgrounds (light blue for user, subtle purple for assistant/thinking)
- Unlimited scroll-up in history (removed 300 entry cap)
- Virtualized list rendering for large transcripts (TanStack Virtual)
- Performance test suite for pagination and large files
- Inline tool results attached to their corresponding tool calls
- Result indicator (✓/❌) shown on tool call summary with accessibility labels

### Changed

- `orbit start` now waits for health check (up to 15s) before reporting success
- **Critical performance fix:** Session discovery now cached in memory
  - `/api/sessions` returns instantly (0-1ms) instead of 6+ seconds
  - Sessions limited to `maxSessions` most recent (default: 10)
  - Client poll interval increased from 10s to 60s (configurable)
  - Reduces idle CPU from 70-100% to <1% of total CPU
- Softer purple background on thinking blocks
- Entry IDs now use byte offsets for stability across pagination loads
- Memoized all entry components for better render performance
- Throttled scroll handler (50ms) to reduce CPU usage
- Increased file read chunk size to 512KB for efficiency
- Toggle button labels now show current state ("Expanded"/"Collapsed") instead of On/Off
- Auto-scroll threshold reduced to 5px for stricter "at bottom" detection
- Stronger light blue background for user entries
- Visible subtle gray background for assistant entry content
- **Major performance improvement:** File watcher now debounced (100ms) to prevent CPU storms
- SSE streaming sends batched entries instead of individual events
- Auto-scroll uses direct DOM manipulation with requestAnimationFrame
- TanStack Virtual `useFlushSync: false` prevents synchronous layout thrashing
- Virtualizer estimates larger row height (200px) to reduce re-measurements

### Fixed

- Virtualization now correctly counts displayed entries (filtering consumed tool results)
- Memoization stability improved with useRef and useCallback for lookup functions
- File truncation (rotation) now detected and handled properly
- Race condition between initial load and file watcher callbacks eliminated
- Session ID verification prevents cross-session event contamination during session switch
- Turn counter now increments correctly for streaming entries (was only working on initial load)
- Empty transcripts now show "No entries in this transcript" instead of stuck "Loading"
- Unknown session lookup returns 404 instantly instead of triggering full filesystem scan
- SSE reconnect now uses exponential backoff (2s-30s) with max 10 retries
- Connection error banner with retry button shown after max retries exhausted
- Session data structure simplified (removed redundant Map, unified around cached array)
- SSE reconnect no longer clears entries if file is temporarily empty (prevents flickering)

## [0.1.0] - 2026-01-27

### Added

- Initial release
- Web-based transcript viewer with dark theme
- Real-time streaming via Server-Sent Events (SSE)
- Session discovery for Claude Code transcripts
- Sidebar with session list (sessions, agents, subagents)
- Active session indicator (modified in last 60s)
- Pagination for large transcripts (30MB+)
- CLI daemon management (start/stop/status/logs)
- Logging via journald (systemd-cat)
