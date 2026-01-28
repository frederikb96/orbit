# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
