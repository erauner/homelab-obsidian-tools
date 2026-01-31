import { homedir } from "node:os";
import { join } from "node:path";

export const VAULT_PATH = process.env.VAULT_PATH
  ?? join(homedir(), "obsidian_vaults", "mdbase_vault");

export const config = {
  vaultPath: VAULT_PATH,
};
