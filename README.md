# Orbit

[![CI](https://github.com/frederikb96/orbit/actions/workflows/ci.yaml/badge.svg)](https://github.com/frederikb96/orbit/actions/workflows/ci.yaml)
[![Release](https://img.shields.io/github/v/release/frederikb96/orbit)](https://github.com/frederikb96/orbit/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Web-based Claude Code transcript viewer with real-time streaming.

## Features

- **Real-time streaming** - SSE-based live updates as transcripts are written
- **Session discovery** - Automatically finds sessions, agents, and subagents
- **Dark theme** - Easy on the eyes for long debugging sessions
- **Pagination** - Handles large transcripts (30MB+) via tail-loading
- **Active indicators** - Shows which sessions are currently active
- **Daemon mode** - Runs as a background service with journald logging

## Requirements

- [Bun](https://bun.sh/) runtime
- Linux with systemd (for daemon mode and logging)
- Claude Code (provides the transcripts to view)

## Installation

```bash
git clone https://github.com/frederikb96/orbit.git
cd orbit
bun install
bun run build
bun link  # makes 'orbit' command globally available
```

## Usage

```bash
orbit start              # Start daemon on port 3000
orbit start -p 8080      # Custom port
orbit stop               # Stop daemon
orbit status             # Show if running
orbit logs -f            # Follow logs (journalctl)
```

Then open http://localhost:3000 in your browser.

## Session Discovery

Orbit finds Claude Code transcripts in:

- `~/.claude/projects/*/*.jsonl` - Main sessions
- `~/.claude/projects/*/agent-*.jsonl` - Agents
- `~/.claude/projects/*/subagents/agent-*.jsonl` - Subagents
- `/tmp/claude/*/tasks/*.output` - Running agents

Sessions modified in the last 60 seconds show as "active".

## Configuration

Orbit looks for config at `~/.config/orbit/config.json`:

```json
{
  "ui": {
    "defaultExpandThinking": true,
    "defaultExpandToolCalls": false,
    "maxEntriesInMemory": 0
  }
}
```

- `defaultExpandThinking`: Show thinking blocks expanded by default
- `defaultExpandToolCalls`: Show tool calls expanded by default
- `maxEntriesInMemory`: Cap entries in browser memory (0 = unlimited)

## Architecture

```
src/
  cli.ts              # Daemon start/stop/status/logs
  server.ts           # HTTP + SSE streaming
  lib/                # Logger, session discovery, transcript parsing
  client/             # React components
public/
  index.html, style.css, bundle.js (generated)
```

## Development

```bash
bun run dev              # Start with watch mode (foreground)
bun run build            # Rebuild client bundle
bun test                 # Run unit tests
bun run lint             # Check with Biome
bun run typecheck        # Type check with tsc
```

## Security Considerations

- **Localhost only** - Server binds to `localhost` (127.0.0.1) by default, not accessible from other machines
- **No authentication** - Anyone with access to the machine can view transcripts
- **Local development use** - Intended for personal/development use, not production deployment
- **Sensitive data** - Transcripts may contain sensitive information (API keys, passwords in commands, etc.)

## License

MIT
