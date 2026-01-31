import { Collection } from "mdbase";
import { config } from "./config.js";

export async function openVault(path?: string) {
  const vaultPath = path ?? config.vaultPath;
  const result = await Collection.open(vaultPath);

  if (result.error) {
    throw new Error(`Failed to open vault at ${vaultPath}: ${result.error.message}`);
  }

  return result.collection!;
}
