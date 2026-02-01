import { homedir } from "node:os";
import { join } from "node:path";

// Parse --vault flag from argv before other processing
function getVaultFromArgs(): string | undefined {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf("--vault");
  if (vaultIdx !== -1 && args[vaultIdx + 1]) {
    return args[vaultIdx + 1];
  }
  return undefined;
}

export const VAULT_PATH = getVaultFromArgs()
  ?? process.env.VAULT_PATH
  ?? join(homedir(), "obsidian_vaults", "mdbase_vault");

export const config = {
  vaultPath: VAULT_PATH,
};
