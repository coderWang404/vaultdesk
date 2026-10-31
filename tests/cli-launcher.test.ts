import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cliLauncherContent, cliStatus, installCli, mcpClientConfig } from "../apps/desktop/src/main/cli-launcher.js";

function fixture(): { home: string; app: string; bundle: string } {
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "vaultdesk-cli-launcher-"));
  const app = path.join(home, "Applications", "VaultDesk.app", "Contents", "MacOS", "VaultDesk");
  const bundle = path.join(home, "Applications", "VaultDesk.app", "Contents", "Resources", "cli", "vaultdesk.cjs");
  fs.mkdirSync(path.dirname(app), { recursive: true });
  fs.mkdirSync(path.dirname(bundle), { recursive: true });
  fs.writeFileSync(app, "app");
  fs.writeFileSync(bundle, "cli");
  return { home, app, bundle };
}

describe("bundled CLI launcher", () => {
  it("installs atomically and reports the managed launcher", () => {
    const { home, app, bundle } = fixture();
    const context = { appExecutable: app, cliBundlePath: bundle };
    expect(cliStatus(context, home).available).toBe(true);
    const status = installCli(context, home);
    expect(status.installed).toBe(true);
    const launcher = path.join(home, ".local/bin/vaultdesk");
    expect(fs.readFileSync(launcher, "utf8")).toBe(cliLauncherContent(app, bundle));
    expect(fs.statSync(launcher).mode & 0o111).toBeTruthy();
    expect(installCli(context, home).installed).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("refuses to replace an unrelated launcher", () => {
    const { home, app, bundle } = fixture();
    const launcher = path.join(home, ".local/bin/vaultdesk");
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, "#!/bin/sh\necho user\n", { mode: 0o755 });
    expect(() => installCli({ appExecutable: app, cliBundlePath: bundle }, home)).toThrow(/未覆盖/);
    expect(fs.readFileSync(launcher, "utf8")).toContain("echo user");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("preserves hand edits even when the launcher retains its marker", () => {
    const { home, app, bundle } = fixture();
    const context = { appExecutable: app, cliBundlePath: bundle };
    const { launcherPath } = installCli(context, home);
    const edited = fs.readFileSync(launcherPath, "utf8").replace(app, `${app}-edited`);
    fs.writeFileSync(launcherPath, edited);
    expect(cliStatus(context, home).conflict).toBe(true);
    expect(() => installCli(context, home)).toThrow(/未覆盖/);
    expect(fs.readFileSync(launcherPath, "utf8")).toBe(edited);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("executes literal paths and arguments while clearing runtime injection variables", () => {
    const { home } = fixture();
    const app = path.join(home, "Application's dir", "VaultDesk fake");
    const bundle = path.join(home, "Resource's dir", "$(touch injected).cjs");
    fs.mkdirSync(path.dirname(app), { recursive: true });
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    fs.writeFileSync(bundle, "cli");
    fs.writeFileSync(app, [
      "#!/bin/sh",
      "printf '%s\\n' \"$ELECTRON_RUN_AS_NODE\" \"${NODE_OPTIONS-unset}\" \"${NODE_PATH-unset}\" \"${ELECTRON_NO_ASAR-unset}\" \"$@\"",
      "",
    ].join("\n"), { mode: 0o755 });
    const { launcherPath } = installCli({ appExecutable: app, cliBundlePath: bundle }, home);
    const argument = "path with 'quotes' and $(touch injected)";
    const result = spawnSync(launcherPath, ["mcp", argument], {
      cwd: home, encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", NODE_OPTIONS: "unexpected", NODE_PATH: "/untrusted", ELECTRON_NO_ASAR: "1" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual(["1", "unset", "unset", "unset", bundle, "mcp", argument]);
    expect(fs.existsSync(path.join(home, "injected"))).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("creates an explicit per-Vault MCP config", () => {
    const parsed = JSON.parse(mcpClientConfig("/Users/me/.local/bin/vaultdesk", "/tmp/My Vault")) as {
      mcpServers: { vaultdesk: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.vaultdesk).toEqual({ command: "/Users/me/.local/bin/vaultdesk", args: ["mcp", "serve", "--vault", "/tmp/My Vault"] });
  });
});
