import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startDevLog } from "./dev-log.mjs";

it.each(["stdout", "stderr"])("keeps private logging after asynchronous %s EPIPE", async failedStream => {
  const directory = mkdtempSync(join(tmpdir(), "acquire-dev-log-"));
  const path = join(directory, "dev.log");
  let attemptedWrites = 0;
  const broken = new Writable({ write(_chunk, _encoding, done) {
    attemptedWrites++;
    setImmediate(() => done(Object.assign(new Error("Closed terminal pipe"), { code: "EPIPE" })));
  } });
  let terminal = "";
  const healthy = new Writable({ write(chunk, _encoding, done) { terminal += chunk; done(); } });
  const stdout = failedStream === "stdout" ? broken : healthy;
  const stderr = failedStream === "stderr" ? broken : healthy;
  const log = startDevLog(path, stdout, stderr);
  try {
    // Wait for the actual Writable error event, not only a synchronous throw.
    const callbackError = await new Promise(resolve => broken.write("first message\n", resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(broken.errored).toMatchObject({ code: "EPIPE" });
    expect(callbackError).toBeUndefined();
    await new Promise(resolve => broken.write("later launcher message\n", resolve));
    const child = spawn(process.execPath, ["-e", "console.log('later child stdout'); console.error('later child stderr');"], { stdio: ["ignore", "pipe", "pipe"] });
    log.attach(child);
    await once(child, "close");
    expect(attemptedWrites).toBe(1);
    const saved = readFileSync(path, "utf8");
    expect(saved).toMatch(/^first message\nlater launcher message\n/);
    expect(saved).toContain("later child stdout\n");
    expect(saved).toContain("later child stderr\n");
    expect(terminal).toContain(failedStream === "stdout" ? "later child stderr" : "later child stdout");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally {
    log.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

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
