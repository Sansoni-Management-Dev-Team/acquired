import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

function command(file, args) {
  const result = spawnSync(file, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !(file === "lsof" && result.status === 1 && !result.stderr)) {
    throw new Error(`Could not inspect development processes with ${file}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function processes() {
  return new Map(command("ps", ["-axo", "pid=,ppid=,command="]).trim().split("\n").map(line => {
    const [, pid, parent, cmd] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return [Number(pid), { pid: Number(pid), parent: Number(parent), command: cmd }];
  }));
}

export function isDevCommand(cmd) {
  return /(?:^|\s)(?:\S*\/)?node\s+(?:\S*\/)?scripts\/dev\.mjs(?:\s|$)/.test(cmd)
    || /(?:next(?:\/dist\/bin\/next)?|wrangler(?:\/(?:bin\/wrangler|wrangler-dist\/cli)\.js)?)\s+dev(?:\s|$)/.test(cmd)
    || /^next-server\s/.test(cmd)
    || /\/workerd\s+serve\s/.test(cmd);
}

// Walk only project-owned development ancestors; never kill a shell or pnpm dev's caller.
export function restartRoot(pid, table, owns, protectedPids) {
  let root;
  const visited = new Set();
  while (table.has(pid) && !visited.has(pid) && !protectedPids.has(pid)) {
    visited.add(pid);
    const entry = table.get(pid);
    if (!owns(pid)) break;
    if (isDevCommand(entry.command)) root = entry;
    pid = entry.parent;
  }
  return root;
}

export async function stopPreviousDevServers(ports, directory = process.cwd()) {
  const table = processes();
  const protectedPids = new Set();
  for (let pid = process.pid; table.has(pid) && !protectedPids.has(pid); pid = table.get(pid).parent) protectedPids.add(pid);
  const project = realpathSync(directory);
  const owns = pid => {
    const cwd = command("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find(line => line.startsWith("n"))?.slice(1);
    try { return cwd && realpathSync(cwd) === project; } catch { return false; }
  };
  const roots = new Map();
  // Inspect all ports before stopping anything, so an unrelated conflict leaves the current app intact.
  for (const port of ports) {
    const listeners = command("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).trim();
    for (const pid of new Set(listeners ? listeners.split(/\s+/).map(Number) : [])) {
      const root = restartRoot(pid, table, owns, protectedPids);
      if (!root || !isDevCommand(table.get(pid)?.command ?? "")) throw new Error(`Port ${port} belongs to an unrelated process (PID ${pid}). Stop it or choose a different development port.`);
      roots.set(root.pid, root);
    }
  }
  if (!roots.size) return;
  const targets = new Map(roots);
  // Include detached child groups, which a terminated launcher can otherwise leave behind.
  let added;
  do {
    added = false;
    for (const [pid, entry] of table) if (targets.has(entry.parent) && !targets.has(pid) && !protectedPids.has(pid)) {
      targets.set(pid, entry);
      added = true;
    }
  } while (added);
  console.info(`Stopping previous Acquire development processes on ports ${ports.join(", ")}…`);
  const signal = (pid, name) => { try { process.kill(pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  for (const pid of targets.keys()) signal(pid, "SIGTERM");
  const deadline = Date.now() + 5000;
  while (targets.size) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const current = processes();
    for (const [pid, entry] of targets) if (current.get(pid)?.command !== entry.command) targets.delete(pid);
    if (Date.now() >= deadline) {
      for (const pid of targets.keys()) signal(pid, "SIGKILL");
      await new Promise(resolve => setTimeout(resolve, 200));
      break;
    }
  }
}
