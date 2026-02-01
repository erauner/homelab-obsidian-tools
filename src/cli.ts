#!/usr/bin/env node
import { openVault } from "./vault.js";
import { config } from "./config.js";
import { ulid } from "ulid";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { resolve } from "node:path";

// Commands that don't need args
const simpleCommands: Record<string, () => Promise<void>> = {
  report: generateReport,
  validate: validateVault,
  list: listFiles,
  inbox: showInbox,
  help: showHelp,
};

// Strip --vault flag from args (already processed in config.ts)
function stripVaultFlag(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--vault") {
      i++; // Skip the value too
    } else {
      result.push(args[i]);
    }
  }
  return result;
}

async function main() {
  const cleanArgs = stripVaultFlag(process.argv.slice(2));
  const [command = "help", ...args] = cleanArgs;

  if (command === "add") {
    await addDocument(args);
  } else if (command === "capture") {
    await captureNote(args);
  } else if (command === "run") {
    await runQuery(args);
  } else if (command === "query") {
    await queryCommand(args);
  } else if (command in simpleCommands) {
    await simpleCommands[command]();
  } else {
    console.error(`Unknown command: ${command}`);
    await showHelp();
    process.exit(1);
  }
}

async function showHelp() {
  console.log(`
obsidian-tools - Vault management CLI

Usage: obsidian-tools <command> [options]

Commands:
  query        Query vault with filters (inline or default: open tasks)
  run <file>   Run a query from a YAML file
  capture      Quick capture a fleeting note to inbox
  inbox        List unprocessed inbox notes
  add <type>   Create a new document
  report       Generate a vault status report
  validate     Validate all files against type schemas
  list         List all files with their types
  help         Show this help

Query Command:
  obsidian-tools query [options]

  Without options, shows open tasks by priority.

  Options:
    --type, -t      Filter by type (can repeat: -t task -t note)
    --where, -w     Filter expression (mdbase expression syntax)
    --order, -o     Sort by field:direction (e.g., priority:asc, due_date:desc)
    --limit, -l     Limit results
    --offset        Skip N results (for pagination)
    --folder, -f    Filter to folder prefix
    --body          Include body content in output
    --json          Output as JSON
    --format        Output format: table, list, json (default: list)

  Examples:
    obsidian-tools query
    obsidian-tools query -t task -w 'status == "open"'
    obsidian-tools query -t task -w 'priority >= 3' -o priority:desc
    obsidian-tools query -t task -t note -w 'tags.contains("urgent")'
    obsidian-tools query --where 'types.contains("actionable")' --limit 10
    obsidian-tools query -f projects/alpha -o file.mtime:desc

Run Command:
  obsidian-tools run <query-file.yaml>

  Execute a query from a YAML file (mdbase query spec format).

  Example query file (queries/overdue.yaml):
    types: [task]
    where: 'due_date < today() && status != "done"'
    order_by:
      - field: due_date
        direction: asc
    limit: 20

  Examples:
    obsidian-tools run queries/overdue.yaml
    obsidian-tools run queries/urgent-tasks.yaml --json

Capture Command:
  obsidian-tools capture <content> [--context "..."] [--source "..."]

  Quick capture a thought to the inbox for later processing.
  Auto-generates ULID filename and timestamps.

  Options:
    --context   Additional context about the note
    --source    Source type (e.g., reading, meeting, thought)

  Examples:
    obsidian-tools capture "Check out Cilium for k8s networking"
    obsidian-tools capture "Auth needs refresh tokens" --context "PR review"
    obsidian-tools capture "Book recommendation" --source reading

Add Command:
  obsidian-tools add <type> [--field value]...

  Options:
    --title     Document title (required for most types)
    --body      Markdown body content
    --tags      Comma-separated tags
    --priority  Priority level (for tasks)
    --status    Status (for tasks: open, in_progress, done)
    --path      Custom file path (optional)

  Examples:
    obsidian-tools add task --title "Fix bug" --priority 1 --status open
    obsidian-tools add note --title "Meeting notes" --body "# Summary..."

Global Options:
  --vault <path>   Override vault path (or use VAULT_PATH env var)
                   Current: ${config.vaultPath}
`);
}

function parseArgs(args: string[]): { type: string; fields: Record<string, unknown> } {
  const [type, ...rest] = args;
  const fields: Record<string, unknown> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rest[++i];
      if (value === undefined) {
        console.error(`Missing value for --${key}`);
        process.exit(1);
      }
      // Parse special fields
      if (key === "tags") {
        fields[key] = value.split(",").map((t) => t.trim());
      } else if (key === "priority") {
        fields[key] = parseInt(value, 10);
      } else {
        fields[key] = value;
      }
    }
  }

  return { type, fields };
}

async function addDocument(args: string[]) {
  if (args.length === 0) {
    console.error("Usage: obsidian-tools add <type> [--field value]...");
    console.error("Example: obsidian-tools add task --title 'New task' --priority 1");
    process.exit(1);
  }

  const { type, fields } = parseArgs(args);
  const { body, path, ...frontmatter } = fields as Record<string, unknown> & { body?: string; path?: string };

  const collection = await openVault();

  const result = await collection.create({
    type,
    path,
    frontmatter,
    body: body as string | undefined,
  });

  if (result.error) {
    console.error(`Failed to create ${type}: ${result.error.message}`);
    await collection.close();
    process.exit(1);
  }

  console.log(`Created ${type}: ${result.path}`);
  await collection.close();
}

async function captureNote(args: string[]) {
  // Parse capture args: collect non-flag args as content, then optional --context and --source
  // Flags consume all following non-flag args until next flag
  const contentParts: string[] = [];
  let context: string | undefined;
  let source: string | undefined;
  let currentFlag: string | null = null;
  const flagParts: string[] = [];

  const flushFlag = () => {
    if (currentFlag === "--context") {
      context = flagParts.join(" ");
    } else if (currentFlag === "--source") {
      source = flagParts.join(" ");
    }
    flagParts.length = 0;
    currentFlag = null;
  };

  for (const arg of args) {
    if (arg === "--context" || arg === "--source") {
      flushFlag();
      currentFlag = arg;
    } else if (arg.startsWith("--")) {
      flushFlag();
      // Unknown flag, ignore
    } else if (currentFlag) {
      flagParts.push(arg);
    } else {
      contentParts.push(arg);
    }
  }
  flushFlag();

  const content = contentParts.join(" ");

  if (!content) {
    console.error("Usage: obsidian-tools capture <content> [--context ...] [--source ...]");
    console.error('Example: obsidian-tools capture "Quick thought to remember"');
    process.exit(1);
  }

  const id = ulid();
  const captured = new Date().toISOString();

  const frontmatter: Record<string, unknown> = {
    id,
    status: "unprocessed",
    captured,
  };

  if (context) frontmatter.context = context;
  if (source) frontmatter.source = source;

  const collection = await openVault();

  const result = await collection.create({
    type: "fleeting",
    frontmatter,
    body: content,
  });

  if (result.error) {
    console.error(`Failed to capture: ${result.error.message}`);
    await collection.close();
    process.exit(1);
  }

  console.log(`Captured: ${result.path}`);
  await collection.close();
}

async function showInbox() {
  const collection = await openVault();

  const result = await collection.query({
    types: ["fleeting"],
    where: 'status == "unprocessed"',
    order_by: [{ field: "captured", direction: "desc" }],
    include_body: true,
  });

  if (result.error) {
    console.error("Query failed:", result.error.message);
    await collection.close();
    process.exit(1);
  }

  const notes = result.results ?? [];

  console.log("Inbox (unprocessed)\n");
  console.log("─".repeat(60));

  if (notes.length === 0) {
    console.log("  No unprocessed notes in inbox.");
  } else {
    for (const doc of notes) {
      const fm = doc.frontmatter as Record<string, unknown>;
      const captured = fm.captured as string;
      const context = fm.context as string | undefined;
      const source = fm.source as string | undefined;
      const id = fm.id as string;

      // Format relative time
      const capturedDate = new Date(captured);
      const relativeTime = formatRelativeTime(capturedDate);

      // Get first line of body as preview
      const preview = (doc.body ?? "").split("\n")[0].slice(0, 50);

      console.log(`[${relativeTime}] ${id.slice(0, 8)}: ${preview}${preview.length >= 50 ? "..." : ""}`);
      if (context) console.log(`         Context: ${context}`);
      if (source) console.log(`         Source: ${source}`);
    }
  }

  console.log(`\nTotal: ${notes.length} unprocessed notes`);
  await collection.close();
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Query options parsed from CLI args
interface QueryOptions {
  types: string[];
  where?: string;
  order_by: Array<{ field: string; direction: string }>;
  limit?: number;
  offset?: number;
  folder?: string;
  include_body: boolean;
  json: boolean;
  format: "table" | "list" | "json";
}

function parseQueryArgs(args: string[]): QueryOptions {
  const options: QueryOptions = {
    types: [],
    order_by: [],
    include_body: false,
    json: false,
    format: "list",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--type":
      case "-t":
        if (next) options.types.push(next);
        i++;
        break;
      case "--where":
      case "-w":
        if (next) options.where = next;
        i++;
        break;
      case "--order":
      case "-o":
        if (next) {
          const [field, dir = "asc"] = next.split(":");
          options.order_by.push({ field, direction: dir });
        }
        i++;
        break;
      case "--limit":
      case "-l":
        if (next) options.limit = parseInt(next, 10);
        i++;
        break;
      case "--offset":
        if (next) options.offset = parseInt(next, 10);
        i++;
        break;
      case "--folder":
      case "-f":
        if (next) options.folder = next;
        i++;
        break;
      case "--body":
        options.include_body = true;
        break;
      case "--json":
        options.json = true;
        options.format = "json";
        break;
      case "--format":
        if (next && ["table", "list", "json"].includes(next)) {
          options.format = next as "table" | "list" | "json";
        }
        i++;
        break;
    }
  }

  return options;
}

async function runQuery(args: string[]) {
  // Parse args for --json flag and file path
  let jsonOutput = false;
  let filePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      jsonOutput = true;
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error("Usage: obsidian-tools run <query-file.yaml> [--json]");
    console.error("Example: obsidian-tools run queries/overdue.yaml");
    process.exit(1);
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    console.error(`Query file not found: ${resolvedPath}`);
    process.exit(1);
  }

  const content = readFileSync(resolvedPath, "utf-8");
  let queryDef: Record<string, unknown>;

  try {
    queryDef = parseYaml(content) as Record<string, unknown>;
  } catch (err) {
    console.error(`Failed to parse YAML: ${(err as Error).message}`);
    process.exit(1);
  }

  // Handle 'query:' wrapper if present
  if (queryDef.query && typeof queryDef.query === "object") {
    queryDef = queryDef.query as Record<string, unknown>;
  }

  const collection = await openVault();

  const result = await collection.query({
    types: queryDef.types as string[] | undefined,
    where: queryDef.where as string | undefined,
    order_by: queryDef.order_by as Array<{ field: string; direction?: string }> | undefined,
    folder: queryDef.folder as string | undefined,
    limit: queryDef.limit as number | undefined,
    offset: queryDef.offset as number | undefined,
    include_body: (queryDef.include_body as boolean) ?? false,
    formulas: queryDef.formulas as Record<string, string> | undefined,
  });

  if (result.error) {
    console.error(`Query failed: ${result.error.message}`);
    await collection.close();
    process.exit(1);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printQueryResults(result.results ?? [], result.meta);
  }

  await collection.close();
}

async function queryCommand(args: string[]) {
  const options = parseQueryArgs(args);
  const collection = await openVault();

  // Default to open tasks if no filters specified
  const hasFilters = options.types.length > 0 || options.where || options.folder;

  const queryInput: Record<string, unknown> = {};

  if (options.types.length > 0) {
    queryInput.types = options.types;
  } else if (!hasFilters) {
    // Default: open tasks
    queryInput.types = ["task"];
  }

  if (options.where) {
    queryInput.where = options.where;
  } else if (!hasFilters) {
    // Default: not done or cancelled
    queryInput.where = 'status != "done" && status != "cancelled"';
  }

  if (options.order_by.length > 0) {
    queryInput.order_by = options.order_by;
  } else if (!hasFilters) {
    // Default: by priority
    queryInput.order_by = [{ field: "priority", direction: "asc" }];
  }

  if (options.folder) queryInput.folder = options.folder;
  if (options.limit) queryInput.limit = options.limit;
  if (options.offset) queryInput.offset = options.offset;
  if (options.include_body) queryInput.include_body = true;

  const result = await collection.query(queryInput as Parameters<typeof collection.query>[0]);

  if (result.error) {
    console.error(`Query failed: ${result.error.message}`);
    await collection.close();
    process.exit(1);
  }

  if (options.format === "json" || options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (!hasFilters) {
      console.log("Open Tasks (by priority)\n");
      console.log("─".repeat(60));
    }
    printQueryResults(result.results ?? [], result.meta, !hasFilters);
  }

  await collection.close();
}

function printQueryResults(
  results: Array<{ path: string; frontmatter: Record<string, unknown>; types: string[]; body?: string | null }>,
  meta?: { total_count?: number; has_more?: boolean },
  taskMode = false
) {
  if (results.length === 0) {
    console.log("  No results found.");
    return;
  }

  for (const doc of results) {
    const fm = doc.frontmatter;

    if (taskMode) {
      // Task-specific formatting
      const priority = fm.priority ?? "?";
      const status = fm.status ?? "unknown";
      const title = fm.title ?? doc.path;
      const tags = (fm.tags as string[])?.join(", ") || "";

      console.log(`[P${priority}] [${status}] ${title}`);
      if (tags) console.log(`       Tags: ${tags}`);
    } else {
      // Generic formatting
      const types = doc.types.length > 0 ? `(${doc.types.join(", ")})` : "(untyped)";
      const title = (fm.title as string) ?? doc.path;

      console.log(`${title} ${types}`);
      console.log(`  Path: ${doc.path}`);

      // Show key frontmatter fields
      const skipFields = ["title", "type"];
      const displayFields = Object.entries(fm)
        .filter(([k]) => !skipFields.includes(k))
        .slice(0, 5);

      for (const [key, value] of displayFields) {
        const displayValue = Array.isArray(value) ? value.join(", ") : String(value);
        console.log(`  ${key}: ${displayValue}`);
      }

      if (doc.body) {
        const preview = doc.body.split("\n")[0].slice(0, 60);
        console.log(`  Body: ${preview}${doc.body.length > 60 ? "..." : ""}`);
      }
      console.log();
    }
  }

  const total = meta?.total_count ?? results.length;
  console.log(`\nTotal: ${results.length}${meta?.has_more ? ` of ${total}` : ""} results`);
}

async function generateReport() {
  const collection = await openVault();

  console.log("Vault Report\n");
  console.log("═".repeat(60));

  // Count by type
  const allDocs = await collection.query({});
  const byType: Record<string, number> = {};

  for (const doc of allDocs.results ?? []) {
    for (const type of doc.types ?? ["untyped"]) {
      byType[type] = (byType[type] ?? 0) + 1;
    }
  }

  console.log("\nFiles by Type:");
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Task status breakdown
  const tasks = await collection.query({ types: ["task"] });
  const byStatus: Record<string, number> = {};

  for (const doc of tasks.results ?? []) {
    const status = (doc.frontmatter as Record<string, unknown>).status as string ?? "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  console.log("\nTask Status:");
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  // Validation summary
  const validation = await collection.validate();
  const errorCount = validation.issues?.length ?? 0;
  const warningCount = validation.warnings?.length ?? 0;

  console.log("\nValidation:");
  console.log(`  Issues: ${errorCount}`);
  console.log(`  Warnings: ${warningCount}`);

  console.log("\n" + "═".repeat(60));
  console.log(`Total files: ${allDocs.results?.length ?? 0}`);

  await collection.close();
}

async function validateVault() {
  const collection = await openVault();

  console.log("Validating vault...\n");

  const result = await collection.validate();

  if (result.issues?.length) {
    console.log("Issues:");
    for (const issue of result.issues) {
      console.log(`  ❌ ${issue.path ?? "unknown"}: ${issue.message}`);
    }
  }

  if (result.warnings?.length) {
    console.log("\nWarnings:");
    for (const warn of result.warnings) {
      console.log(`  ⚠️  ${warn}`);
    }
  }

  if (!result.issues?.length && !result.warnings?.length) {
    console.log("✅ All files valid!");
  }

  await collection.close();
}

async function listFiles() {
  const collection = await openVault();

  const result = await collection.query({});

  console.log("Files in vault:\n");

  for (const doc of result.results ?? []) {
    const types = doc.types?.length ? `(${doc.types.join(", ")})` : "(untyped)";
    console.log(`  ${doc.path} ${types}`);
  }

  console.log(`\nTotal: ${result.results?.length ?? 0} files`);
  await collection.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
