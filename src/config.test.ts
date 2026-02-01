import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Test the expandHome logic directly (extracted for testing)
function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  if (p === "~") {
    return homedir();
  }
  return p;
}

describe("expandHome", () => {
  it("expands ~/path to homedir/path", () => {
    const result = expandHome("~/test/vault");
    expect(result).toBe(join(homedir(), "test/vault"));
  });

  it("expands ~ alone to homedir", () => {
    const result = expandHome("~");
    expect(result).toBe(homedir());
  });

  it("leaves absolute paths unchanged", () => {
    const result = expandHome("/absolute/path");
    expect(result).toBe("/absolute/path");
  });

  it("leaves relative paths unchanged", () => {
    const result = expandHome("relative/path");
    expect(result).toBe("relative/path");
  });

  it("does not expand ~ in middle of path", () => {
    const result = expandHome("/path/~/middle");
    expect(result).toBe("/path/~/middle");
  });
});

describe("path resolution", () => {
  it("resolve makes paths absolute", () => {
    const expanded = expandHome("~/vaults/test");
    const resolved = resolve(expanded);
    expect(resolved.startsWith("/")).toBe(true);
  });
});
