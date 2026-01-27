# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
