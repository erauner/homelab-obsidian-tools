#!/usr/bin/env node
import { openVault } from "./vault.js";
import { config } from "./config.js";

// Commands that don't need args
const simpleCommands: Record<string, () => Promise<void>> = {
  query: queryTasks,
  report: generateReport,
  validate: validateVault,
  list: listFiles,
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
  add <type>   Create a new document
  query        Query open tasks by priority
  report       Generate a vault status report
  validate     Validate all files against type schemas
  list         List all files with their types
  help         Show this help

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
    obsidian-tools add task --title "Review PR" --tags work,urgent --priority 1
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

async function queryTasks() {
  const collection = await openVault();

  console.log("Open Tasks (by priority)\n");
  console.log("─".repeat(60));

  const result = await collection.query({
    types: ["task"],
    where: 'status != "done" && status != "cancelled"',
    order_by: [{ field: "priority", direction: "asc" }],
  });

  if (result.error) {
    console.error("Query failed:", result.error.message);
    process.exit(1);
  }

  for (const doc of result.results ?? []) {
    const fm = doc.frontmatter as Record<string, unknown>;
    const priority = fm.priority ?? "?";
    const status = fm.status ?? "unknown";
    const title = fm.title ?? doc.path;
    const tags = (fm.tags as string[])?.join(", ") || "";

    console.log(`[P${priority}] [${status}] ${title}`);
    if (tags) console.log(`       Tags: ${tags}`);
  }

  console.log(`\nTotal: ${result.results?.length ?? 0} tasks`);
  await collection.close();
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
