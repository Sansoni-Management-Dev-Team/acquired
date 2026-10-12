import { existsSync, readFileSync } from "node:fs";

/** Explicit blanks stop Next's env-file loader from reviving a live provider in fixtures. */
export function disabledCommunicationsEnvironment(sources = [], localEnvFile = ".env.local") {
  const keys = new Set([
    "UNIPILE_API_KEY", "UNIPILE_API_URL", "UNIPILE_BASE_URL", "UNIPILE_DSN", "UNIPILE_API_VERSION",
    "COMMUNICATIONS_SERVICE_URL", "COMMUNICATIONS_SERVICE_SECRET",
  ]);
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if (/^(?:NEXT_PUBLIC_)?(?:UNIPILE_|COMMUNICATIONS_)/.test(key)) keys.add(key);
    }
  }
  if (existsSync(localEnvFile)) {
    // Discover names only, rather than parsing credential values into fixture configuration.
    for (const line of readFileSync(localEnvFile, "utf8").split(/\r?\n/)) {
      const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
      if (key && /^(?:NEXT_PUBLIC_)?(?:UNIPILE_|COMMUNICATIONS_)/.test(key)) keys.add(key);
    }
  }
  return Object.fromEntries([...keys].map(key => [key, ""]));
}
