import { spawnSync } from "node:child_process";

// OrbStack is macOS-only; elsewhere use the current Docker context.
export const orbstackAvailable = spawnSync("docker", ["context", "inspect", "orbstack"], { stdio: "ignore" }).status === 0;
export const dockerContextArgs = orbstackAvailable ? ["--context", "orbstack"] : [];
