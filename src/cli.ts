#!/usr/bin/env node
import { openVault } from "./vault.js";
import { config } from "./config.js";
import { ulid } from "ulid";

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

  if (command === "capture") {
    await captureNote(args);
  } else if (command === "inbox") {
    await showInbox();
  } else if (command === "help" || command === "--help" || command === "-h") {
    showHelp();
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("");
    console.error("For general vault operations, use: mdbase <command>");
    console.error("This tool only provides: capture, inbox");
    showHelp();
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
obsidian-tools - Quick capture for Obsidian vaults

Usage: obsidian-tools <command> [options]

Commands:
  capture      Quick capture a fleeting note to inbox
  inbox        List unprocessed inbox notes
  help         Show this help

For general vault operations (query, add, validate, etc.), use:
  mdbase --vault <path> <command>

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

Inbox Command:
  obsidian-tools inbox

  Lists all unprocessed fleeting notes, sorted by capture time (newest first).

Global Options:
  --vault <path>   Override vault path (or use VAULT_PATH env var)
                   Current: ${config.vaultPath}
`);
}

async function captureNote(args: string[]) {
  // Parse capture args: collect non-flag args as content, then optional --context and --source
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

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
