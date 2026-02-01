import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CLI integration", () => {
  const testVaultDir = join(tmpdir(), `obsidian-tools-test-${Date.now()}`);
  const tasksDir = join(testVaultDir, "tasks");
  const typesDir = join(testVaultDir, "_types");
  const inboxDir = join(testVaultDir, "inbox");

  beforeAll(() => {
    // Create a minimal test vault
    mkdirSync(testVaultDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });
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

    // Create task type
    writeFileSync(
      join(typesDir, "task.md"),
      `---
name: task
description: Task type
path_pattern: tasks/{title}.md
match:
  fields_present:
    - status
fields:
  title:
    type: string
    required: true
  status:
    type: enum
    values: [open, in_progress, done]
    default: open
  priority:
    type: number
    min: 1
    max: 5
    default: 3
  tags:
    type: list
    item_type: string
---
`
    );

    // Create note type
    writeFileSync(
      join(typesDir, "note.md"),
      `---
name: note
description: Note type
path_pattern: "{title}.md"
match:
  path_glob: "**/*.md"
fields:
  title:
    type: string
  tags:
    type: list
    item_type: string
---
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

  it("add task creates file with correct frontmatter", () => {
    const output = runCli('add task --title "Test CLI Task" --priority 1 --status open --tags test,cli');

    expect(output).toContain("Created task:");
    expect(output).toContain("tasks/Test CLI Task.md");

    const taskPath = join(tasksDir, "Test CLI Task.md");
    expect(existsSync(taskPath)).toBe(true);

    const content = readFileSync(taskPath, "utf-8");
    expect(content).toContain("title: Test CLI Task");
    expect(content).toContain("priority: 1");
    expect(content).toContain("status: open");
    expect(content).toContain("- test");
    expect(content).toContain("- cli");
  });

  it("query shows created task", () => {
    const output = runCli("query");

    expect(output).toContain("Test CLI Task");
    expect(output).toContain("[P1]");
    expect(output).toContain("[open]");
  });

  it("list shows task file", () => {
    const output = runCli("list");

    expect(output).toContain("tasks/Test CLI Task.md");
    expect(output).toContain("task");
  });

  it("validate passes for valid files", () => {
    const output = runCli("validate");

    expect(output).toContain("valid");
  });

  it("report shows correct counts", () => {
    const output = runCli("report");

    expect(output).toContain("task:");
    expect(output).toContain("open:");
  });

  it("add note creates file in vault root", () => {
    const output = runCli('add note --title "Test Note" --body "# Hello World"');

    expect(output).toContain("Created note:");
    expect(output).toContain("Test Note.md");

    const notePath = join(testVaultDir, "Test Note.md");
    expect(existsSync(notePath)).toBe(true);

    const content = readFileSync(notePath, "utf-8");
    expect(content).toContain("title: Test Note");
    expect(content).toContain("# Hello World");
  });

  it("help shows usage info", () => {
    const output = runCli("help");

    expect(output).toContain("obsidian-tools");
    expect(output).toContain("add <type>");
    expect(output).toContain("query");
    expect(output).toContain("--vault");
  });

  it("add with missing type shows error", () => {
    const output = runCli("add");

    expect(output).toContain("Usage:");
  });

  it("unknown command shows help", () => {
    const output = runCli("unknown-command");

    expect(output).toContain("Unknown command");
  });

  it("capture creates fleeting note in inbox", () => {
    const output = runCli('capture "Test fleeting note content"');

    expect(output).toContain("Captured:");
    expect(output).toContain("inbox/");
    expect(output).toContain(".md");

    // Verify a file was created in inbox
    const { readdirSync } = require("node:fs");
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
    const { readdirSync, statSync } = require("node:fs");
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
});
