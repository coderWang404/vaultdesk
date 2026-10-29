import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "../apps/desktop/src/main/trusted-url.js";

describe("trusted renderer URL", () => {
  it("accepts the exact development page with query and fragment", () => {
    expect(isTrustedRendererUrl("http://localhost:5173/app?tab=skills#current", "http://localhost:5173/app")).toBe(true);
  });

  it("rejects lookalike hosts and paths", () => {
    const target = "http://localhost:5173/app";
    expect(isTrustedRendererUrl("http://localhost.evil.example:5173/app", target)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173/application", target)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173@evil.example/app", target)).toBe(false);
  });

  it("accepts only the packaged renderer file", () => {
    const target = "file:///Applications/VaultDesk.app/Contents/Resources/app.asar/out/renderer/index.html";
    expect(isTrustedRendererUrl(target, target)).toBe(true);
    expect(isTrustedRendererUrl(target.replace("index.html", "other.html"), target)).toBe(false);
    expect(isTrustedRendererUrl(target.replace("file:///", "file://remote/"), target)).toBe(false);
    expect(isTrustedRendererUrl("not a URL", target)).toBe(false);
  });
});
