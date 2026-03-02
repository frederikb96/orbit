<table>
<tr>
<td width="140">
<img src="docs/logo.png" alt="Orbit" width="120">
</td>
<td>
<h1>Orbit</h1>

[![CI](https://github.com/frederikb96/orbit/actions/workflows/ci.yaml/badge.svg)](https://github.com/frederikb96/orbit/actions/workflows/ci.yaml)
[![Release](https://img.shields.io/github/v/release/frederikb96/orbit)](https://github.com/frederikb96/orbit/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Web-based Claude Code transcript viewer with real-time streaming.
</td>
</tr>
</table>

## Features

- **Real-time streaming** - SSE-based live updates as transcripts change
- **Session discovery** - Finds sessions, agents, and subagents automatically
- **Dark theme** - Easy on the eyes for long sessions
- **Pagination** - Handles large transcripts (30MB+) efficiently
- **Active indicators** - Shows which sessions are currently being written
- **MRU switcher** - Alt+Tab style session switching
- **Daemon mode** - Background service with journald logging

## Requirements

- [Bun](https://bun.sh/) runtime
- Linux with systemd (daemon mode and logging)
- Claude Code (provides the transcripts)

## Installation

```bash
git clone https://github.com/frederikb96/orbit.git
cd orbit
bun install
bun run build
bun link
```

## Usage

```bash
orbit start              # Start daemon on port 3000
orbit start -p 8080      # Custom port
orbit stop               # Stop daemon
orbit status             # Check if running
orbit logs -f            # Follow logs
```

Open http://localhost:3000 in your browser.

**Note:** Server binds to localhost only for security - not accessible from other machines.

### Auto-start with systemd

For automatic startup on login, create a user service at `~/.config/systemd/user/orbit.service`:

```ini
[Unit]
Description=Orbit - Claude Code transcript viewer
After=default.target

[Service]
Type=simple
ExecStart=/path/to/orbit start --foreground
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=orbit

[Install]
WantedBy=default.target
```

Adjust `ExecStart` to point to your `orbit` binary (typically `~/.bun/bin/orbit` after `bun link`). If `bun` isn't in systemd's PATH, set it via `Environment="PATH=..."`.

```bash
systemctl --user daemon-reload
systemctl --user enable --now orbit
```

When managed by systemd, the CLI detects this automatically — `orbit stop` redirects to `systemctl`, `orbit status` shows the management mode, and `orbit logs` reads from the correct journal source.

## Keyboard Shortcuts

**Plain keys** (in transcript views):

- **Home** - Scroll to top
- **End** - Scroll to bottom (enables autoscroll)
- **PageUp** - Scroll up one page
- **PageDown** - Scroll down one page

**Shift+Alt** modifier:

- **Q** - MRU session switcher (hold modifiers, press Q to cycle, release to confirm)
- **PageUp** or **,** - Previous session (up in list)
- **PageDown** or **.** - Next session (down in list)
- **T** - Toggle thinking block expansion
- **O** - Toggle tool call expansion
- **S** - Enable autoscroll and jump to bottom
- **R** - Reload transcript

## Session Discovery

Finds Claude Code transcripts in:

- `~/.claude/projects/*/*.jsonl` - Main sessions
- `~/.claude/projects/*/agent-*.jsonl` - Agents
- `~/.claude/projects/*/subagents/agent-*.jsonl` - Subagents
- `/tmp/claude/*/tasks/*.output` - Running agents

## Configuration

Config file: `~/.config/orbit/config.json`

```json
{
  "ui": {
    "defaultExpandThinking": true,
    "defaultExpandToolCalls": false,
    "sessionTitleCommand": "your-command {sessionId}"
  }
}
```

**UI options:**
- `defaultExpandThinking` / `defaultExpandToolCalls` - Default expand state
- `sessionTitleCommand` - Command to fetch session titles (`{sessionId}` placeholder)
- `sessionTitleIntervalMs` - Title refresh interval

See `src/lib/config.ts` for all available options and defaults.

## Development

```bash
bun run dev         # Start with watch mode
bun run build       # Build client bundle
bun test            # Run tests
bun run lint        # Check with Biome
bun run typecheck   # Type check
```

## License

MIT
