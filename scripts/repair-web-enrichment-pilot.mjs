import { readFile, writeFile, copyFile, constants } from "node:fs/promises";
import { normalizePilot } from "./lib/web-enrichment.mjs";

const path = ".local-data/manufacturer-web-enrichment-pilot.json";
const backup = ".local-data/manufacturer-web-enrichment-pilot.v1.json";
try { await copyFile(path, backup, constants.COPYFILE_EXCL); }
catch (error) { if (error.code !== "EEXIST") throw error; }
const raw = JSON.parse(await readFile(backup, "utf8"));
const repaired = normalizePilot(raw);
await writeFile(path, JSON.stringify(repaired, null, 2) + "\n");
console.log(JSON.stringify(repaired.summary));
