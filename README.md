# homelab-obsidian-tools

TypeScript tools for programmatic Obsidian vault management via [mdbase](../mdbase-cli).

## Setup

```bash
npm install
```

## Usage

```bash
# Query open tasks
npm run query

# Generate vault report
npm run report

# Validate all files
npm run validate

# Or use the CLI directly
npm run dev -- <command>
```

## Commands

| Command    | Description                           |
|------------|---------------------------------------|
| `query`    | Query open tasks ordered by priority  |
| `report`   | Generate vault status report          |
| `validate` | Validate files against type schemas   |
| `list`     | List all files with their types       |
| `help`     | Show help                             |

## Configuration

Set `VAULT_PATH` environment variable to override the default vault location:

```bash
VAULT_PATH=/path/to/vault npm run query
```

Default: `~/obsidian_vaults/mdbase_vault`

## Development

```bash
# Run in development mode
npm run dev -- query

# Build for production
npm run build

# Run tests
npm test
```
