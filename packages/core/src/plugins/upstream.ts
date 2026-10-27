import path from "node:path";
import { isDirectory, isInside } from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import type { SourceRecord } from "../types.js";

export function resolvePluginUpstreamRoot(source: SourceRecord, fetchedRoot: string): string {
  const relative = source.contentPath && source.contentPath !== "." ? source.contentPath : "";
  const root = relative ? path.resolve(fetchedRoot, relative) : fetchedRoot;
  if (!isInside(root, fetchedRoot)) {
    throw new VaultDeskError("path-escape", `content_path escapes the upstream checkout for ${source.name}`);
  }
  if (!isDirectory(root)) {
    throw new VaultDeskError(
      "upstream-not-found",
      `Upstream plugin root not found for ${source.name}: ${source.contentPath ?? "."}`,
    );
  }
  return root;
}
