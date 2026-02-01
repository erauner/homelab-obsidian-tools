import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Expand ~ to home directory
function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  if (p === "~") {
    return homedir();
  }
  return p;
}

// Parse --vault flag from argv before other processing
function getVaultFromArgs(): string | undefined {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf("--vault");
  if (vaultIdx !== -1 && args[vaultIdx + 1]) {
    return expandHome(args[vaultIdx + 1]);
  }
  return undefined;
}

// Also expand ~ in VAULT_PATH env var
function getVaultPath(): string {
  const fromArgs = getVaultFromArgs();
  if (fromArgs) return resolve(fromArgs);

  const fromEnv = process.env.VAULT_PATH;
  if (fromEnv) return resolve(expandHome(fromEnv));

  return join(homedir(), "obsidian_vaults", "mdbase_vault");
}

export const VAULT_PATH = getVaultPath();

export const config = {
  vaultPath: VAULT_PATH,
};
