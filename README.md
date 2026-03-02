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

- **Dual-mode viewing** - Live mode (real-time streaming) and Archive mode (frozen snapshot with virtualized scrolling)
- **In-transcript search** - Ctrl+F with match navigation, auto-expand of collapsed blocks, and gold text highlighting
- **Session search** - Fuzzy search across all sessions on disk by name and UUID (Ctrl+K)
- **Syntax highlighting** - Shiki-based with lazy loading for code blocks, diffs, and tool results
- **Markdown rendering** - GFM with XSS sanitization for messages and responses
- **Light/dark/system theme** - Toggle in sidebar header, persisted to localStorage
- **Session discovery** - Finds sessions, agents, and subagents automatically with active indicators
- **MRU switcher** - Alt+Tab style session switching (Shift+Alt+Q)
- **Daemon mode** - Background service with systemd support and journald logging

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

**Search:**

- **Ctrl+F** - In-transcript search (Enter/Shift+Enter to navigate matches)
- **Ctrl+K** - Focus session search bar

**Plain keys** (in transcript views):

- **Home** - Scroll to top
- **End** - Scroll to bottom
- **PageUp/PageDown** - Scroll one page

**Shift+Alt** modifier:

- **H** - Toggle Live/Archive mode
- **Q** - MRU session switcher (hold modifiers, press Q to cycle, release to confirm)
- **,** or **PageUp** - Previous session
- **.** or **PageDown** - Next session
- **T** - Toggle thinking block expansion
- **E** - Toggle edit/write tool expansion
- **O** - Toggle other tool expansion
- **S** - Jump to bottom
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
