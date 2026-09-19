# Manual Installation

If you prefer to configure Compendio manually, or if your agent is not supported by the `install-mcp` command, add the following configuration to your agent's MCP settings.

## Claude Code

Create or edit `.mcp.json` at the repo root (for project-level) or `~/.claude.json` (for global):

```json
{
  "mcpServers": {
    "compendio": {
      "command": "compendio",
      "args": ["serve"]
    }
  }
}
```

## Claude Desktop

Edit the config file at:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Or use Settings → Developer → Edit Config.

```json
{
  "mcpServers": {
    "compendio": {
      "command": "compendio",
      "args": ["serve"]
    }
  }
}
```

## Cursor

Create or edit `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "compendio": {
      "command": "compendio",
      "args": ["serve"]
    }
  }
}
```

## VS Code / Copilot

Create or edit `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "compendio": {
      "type": "stdio",
      "command": "compendio",
      "args": ["serve"]
    }
  }
}
```

## OpenCode

Edit `opencode.json` (typically `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "compendio": {
      "type": "local",
      "command": ["compendio", "serve"],
      "enabled": true
    }
  }
}
```

## Codex

Create or edit `.codex/config.toml` in your project:

```toml
[mcp_servers.compendio]
command = "npx"
args = ["compendio-mcp", "serve"]
enabled = true
startup_timeout_sec = 60
```

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "compendio": {
      "command": "compendio",
      "args": ["serve"]
    }
  }
}
```

## Zed

Edit `settings.json`, or use Settings → AI → MCP Servers → Add Custom Server:

```json
{
  "context_servers": {
    "compendio": {
      "command": "compendio",
      "args": ["serve"],
      "env": {}
    }
  }
}
```

## Cline

Use MCP Servers icon → Configure → *Configure MCP Servers*. The CLI reads `~/.cline/mcp.json`:

```json
{
  "mcpServers": {
    "compendio": {
      "command": "compendio",
      "args": ["serve"]
    }
  }
}
```

## Gemini CLI

Create or edit `.gemini/settings.json` in your project, or `~/.gemini/settings.json` for global:

```json
{
  "mcpServers": {
    "compendio": {
      "command": "compendio",
      "args": ["serve"]
    }
  }
}
```

## Windows Note

Some MCP clients can't spawn the `compendio.cmd` shim directly. If the server fails to start with `ENOENT`, use `"command": "npx"` with `"args": ["compendio-mcp", "serve"]` instead.
