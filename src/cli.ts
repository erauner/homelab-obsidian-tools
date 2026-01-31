#!/usr/bin/env node
import { openVault } from "./vault.js";
import { config } from "./config.js";

const commands: Record<string, () => Promise<void>> = {
  query: queryTasks,
  report: generateReport,
  validate: validateVault,
  list: listFiles,
  help: showHelp,
};

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  if (command in commands) {
    await commands[command]();
  } else {
    console.error(`Unknown command: ${command}`);
    await showHelp();
    process.exit(1);
  }
}

async function showHelp() {
  console.log(`
homelab-obsidian-tools - Vault management CLI

Usage: vault <command>

Commands:
  query      Query open tasks by priority
  report     Generate a vault status report
  validate   Validate all files against type schemas
  list       List all files with their types
  help       Show this help

Environment:
  VAULT_PATH   Override default vault path
               Current: ${config.vaultPath}
`);
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
  const errorCount = validation.errors?.length ?? 0;
  const warningCount = validation.warnings?.length ?? 0;

  console.log("\nValidation:");
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Warnings: ${warningCount}`);

  console.log("\n" + "═".repeat(60));
  console.log(`Total files: ${allDocs.results?.length ?? 0}`);

  await collection.close();
}

async function validateVault() {
  const collection = await openVault();

  console.log("Validating vault...\n");

  const result = await collection.validate();

  if (result.errors?.length) {
    console.log("Errors:");
    for (const err of result.errors) {
      console.log(`  ❌ ${err.path}: ${err.message}`);
    }
  }

  if (result.warnings?.length) {
    console.log("\nWarnings:");
    for (const warn of result.warnings) {
      console.log(`  ⚠️  ${warn.path}: ${warn.message}`);
    }
  }

  if (!result.errors?.length && !result.warnings?.length) {
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
