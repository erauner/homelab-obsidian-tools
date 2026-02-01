# obsidian-tools

CLI for programmatic Obsidian vault management via [mdbase](https://github.com/erauner/mdbase-cli).

## Installation

```bash
# Configure npm for @erauner scope (one-time)
npm config set @erauner:registry https://nexus.erauner.dev/repository/npm-hosted/

# Install globally
npm install -g @erauner/obsidian-tools
```

## Usage

```bash
obsidian-tools --vault ~/path/to/vault <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `add <type>` | Create a new task or note |
| `query` | List open tasks by priority |
| `report` | Generate vault statistics |
| `validate` | Check files against type schemas |
| `list` | List all files with their types |
| `help` | Show help |

### Add Command

```bash
# Add a task
obsidian-tools --vault ~/vault add task --title "Fix bug" --priority 1 --status open --tags work,urgent

# Add a note
obsidian-tools --vault ~/vault add note --title "Meeting notes" --body "# Summary..."
```

**Options:**
- `--title` - Document title (required)
- `--body` - Markdown body content
- `--tags` - Comma-separated tags
- `--priority` - Priority level 1-5 (tasks only)
- `--status` - Status: open, in_progress, done, cancelled (tasks only)

### Query Command

```bash
obsidian-tools --vault ~/vault query
```

Output:
```
[P1] [open] Fix critical bug
       Tags: urgent, work
[P2] [in_progress] Review PR
       Tags: work
```

## Configuration

The vault path can be set via:
1. `--vault <path>` flag (highest priority)
2. `VAULT_PATH` environment variable
3. Default: `~/obsidian_vaults/mdbase_vault`

## Development

```bash
# Clone and install
git clone https://github.com/erauner/homelab-obsidian-tools
cd homelab-obsidian-tools
npm install

# Run in dev mode
npm run dev -- --vault ~/vault query

# Build
npm run build

# Run tests
npm test
```

## Related

- [mdbase-cli](https://github.com/erauner/mdbase-cli) - Core mdbase library
- [homelab-obsidian-vault](https://github.com/erauner/homelab-obsidian-vault) - Example vault
