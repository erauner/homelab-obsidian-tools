import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CLI integration", () => {
  const testVaultDir = join(tmpdir(), `obsidian-tools-test-${Date.now()}`);
  const typesDir = join(testVaultDir, "_types");
  const inboxDir = join(testVaultDir, "inbox");

  beforeAll(() => {
    // Create a minimal test vault
    mkdirSync(testVaultDir, { recursive: true });
    mkdirSync(typesDir, { recursive: true });
    mkdirSync(inboxDir, { recursive: true });

    // Create mdbase.yaml
    writeFileSync(
      join(testVaultDir, "mdbase.yaml"),
      `spec_version: "0.1"
settings:
  types_folder: _types
  default_validation: warn
  include_subfolders: true
`
    );

    // Create fleeting type for capture/inbox
    writeFileSync(
      join(typesDir, "fleeting.md"),
      `---
name: fleeting
description: Quick capture notes for later processing
path_pattern: inbox/{id}.md
match:
  fields_present:
    - captured
fields:
  id:
    type: string
    required: true
  status:
    type: enum
    values:
      - unprocessed
      - processing
      - processed
      - archived
    default: unprocessed
    required: true
  captured:
    type: datetime
    required: true
  context:
    type: string
    required: false
  source:
    type: string
    required: false
---
`
    );
  });

  afterAll(() => {
    // Cleanup test vault
    rmSync(testVaultDir, { recursive: true, force: true });
  });

  const runCli = (args: string): string => {
    try {
      return execSync(`npx tsx src/cli.ts --vault "${testVaultDir}" ${args} 2>&1`, {
        cwd: join(import.meta.dirname, ".."),
        encoding: "utf-8",
        env: { ...process.env, VAULT_PATH: undefined },
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string };
      return execError.stdout || execError.stderr || String(error);
    }
  };

  it("help shows usage info", () => {
    const output = runCli("help");

    expect(output).toContain("obsidian-tools");
    expect(output).toContain("capture");
    expect(output).toContain("inbox");
    expect(output).toContain("--vault");
  });

  it("--help works", () => {
    const output = runCli("--help");
    expect(output).toContain("obsidian-tools");
  });

  it("unknown command shows help and suggests mdbase", () => {
    const output = runCli("unknown-command");

    expect(output).toContain("Unknown command");
    expect(output).toContain("mdbase");
  });

  it("capture creates fleeting note in inbox", () => {
    const output = runCli('capture "Test fleeting note content"');

    expect(output).toContain("Captured:");
    expect(output).toContain("inbox/");
    expect(output).toContain(".md");

    // Verify a file was created in inbox
    const inboxFiles = readdirSync(inboxDir).filter((f: string) => f.endsWith(".md"));
    expect(inboxFiles.length).toBeGreaterThan(0);

    // Read the created file
    const createdFile = inboxFiles[0];
    const content = readFileSync(join(inboxDir, createdFile), "utf-8");
    expect(content).toContain("status: unprocessed");
    expect(content).toContain("captured:");
    expect(content).toContain("Test fleeting note content");
  });

  it("capture with context and source adds metadata", () => {
    const output = runCli('capture "Another thought" --context "Testing CLI" --source thought');

    expect(output).toContain("Captured:");

    // Find the newest file in inbox
    const inboxFiles = readdirSync(inboxDir)
      .filter((f: string) => f.endsWith(".md"))
      .map((f: string) => ({ name: f, mtime: statSync(join(inboxDir, f)).mtime }))
      .sort((a: { mtime: Date }, b: { mtime: Date }) => b.mtime.getTime() - a.mtime.getTime());

    const newestFile = inboxFiles[0].name;
    const content = readFileSync(join(inboxDir, newestFile), "utf-8");
    expect(content).toContain("context: Testing CLI");
    expect(content).toContain("source: thought");
    expect(content).toContain("Another thought");
  });

  it("capture without content shows usage", () => {
    const output = runCli("capture");

    expect(output).toContain("Usage:");
  });

  it("inbox shows captured notes", () => {
    const output = runCli("inbox");

    expect(output).toContain("Inbox (unprocessed)");
    expect(output).toContain("Test fleeting note content");
    expect(output).toContain("Total:");
  });

  it("inbox shows context and source metadata", () => {
    const output = runCli("inbox");

    expect(output).toContain("Context: Testing CLI");
    expect(output).toContain("Source: thought");
  });

  it("inbox shows relative time", () => {
    const output = runCli("inbox");

    // Should show relative time like "just now" or "1m ago"
    expect(output).toMatch(/\[(just now|\d+[mhd] ago|\d{1,2}\/\d{1,2}\/\d{4})\]/);
  });

  it("inbox on empty vault shows message", async () => {
    // Create a separate empty vault
    const emptyVault = join(tmpdir(), `obsidian-tools-empty-${Date.now()}`);
    const emptyTypes = join(emptyVault, "_types");
    const emptyInbox = join(emptyVault, "inbox");
    mkdirSync(emptyVault, { recursive: true });
    mkdirSync(emptyTypes, { recursive: true });
    mkdirSync(emptyInbox, { recursive: true });

    writeFileSync(
      join(emptyVault, "mdbase.yaml"),
      `spec_version: "0.1"
settings:
  types_folder: _types
`
    );

    writeFileSync(
      join(emptyTypes, "fleeting.md"),
      `---
name: fleeting
path_pattern: inbox/{id}.md
match:
  fields_present:
    - captured
fields:
  id:
    type: string
  status:
    type: enum
    values: [unprocessed, processed]
  captured:
    type: datetime
---
`
    );

    const output = execSync(`npx tsx src/cli.ts --vault "${emptyVault}" inbox 2>&1`, {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf-8",
    });

    expect(output).toContain("No unprocessed notes");

    rmSync(emptyVault, { recursive: true, force: true });
  });
});
