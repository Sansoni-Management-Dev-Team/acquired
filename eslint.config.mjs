import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // These operator scripts are intentionally CommonJS, rather than TS modules.
  {files:["scripts/**/*.cjs"],rules:{"@typescript-eslint/no-require-imports":"off"}},
  globalIgnores([".next/**", ".next-campaign-integration/**", "coverage/**", ".local-data/**", "**/.wrangler/**", "services/research/dist/**"]),
]);
