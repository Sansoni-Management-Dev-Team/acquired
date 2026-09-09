import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startDevLog } from "./dev-log.mjs";

it("mirrors launcher and child stdout/stderr, preserves Unicode, and clears on restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "acquire-dev-log-"));
  const path = join(directory, "dev.log");
  let terminal = "";
  const stdout = new Writable({ write(chunk, _encoding, done) { terminal += chunk; done(); } });
  const stderr = new Writable({ write(chunk, _encoding, done) { terminal += chunk; done(); } });
  let log = startDevLog(path, stdout, stderr);
  try {
    stdout.write("launcher\n");
    const child = spawn(process.execPath, ["-e", "console.log('worker ready'); console.error('app error');"], { stdio: ["ignore", "pipe", "pipe"] });
    log.attach(child);
    await once(child, "close");
    const bytes = Buffer.from("✓");
    stdout.write(bytes.subarray(0, 1));
    stdout.write(bytes.subarray(1));
    stdout.write("\u001b[32mready\u001b[0m\n");
    expect(readFileSync(path, "utf8")).toContain("launcher\n");
    expect(readFileSync(path, "utf8")).toContain("worker ready\n");
    expect(readFileSync(path, "utf8")).toContain("app error\n");
    expect(readFileSync(path, "utf8")).toContain("✓ready\n");
    expect(terminal).toContain("worker ready\n");
    expect(terminal).toContain("app error\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    log.close();
    log = startDevLog(path, stdout, stderr);
    stdout.write("new session\n");
    expect(readFileSync(path, "utf8")).toBe("new session\n");
  } finally {
    log.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
