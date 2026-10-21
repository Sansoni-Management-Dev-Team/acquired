import { FirmableClient, type FirmableClientOptions } from "./firmable-client";
import { createFixtureProviderClients } from "./fixture-provider";
import { GooglePlacesClient } from "./google-places-client";
import { ManufacturingDirectoryClient, searchManufacturingBusinesses } from "./manufacturing-directory-client";

export type TargetDataProviderMode = "fixture" | "live";

export function resolveTargetDataProviderMode(value: string | undefined): TargetDataProviderMode {
  if (value === "fixture" || value === "live") return value;
  throw new Error('TARGET_DATA_PROVIDER must be explicitly set to "fixture" or "live"');
}

export function createTargetDataProvider(mode = resolveTargetDataProviderMode(process.env.TARGET_DATA_PROVIDER), firmableOptions: Pick<FirmableClientOptions, "onObservation" | "traceContext"> = {}) {
  const manufacturingDirectory = new ManufacturingDirectoryClient();
  if (mode === "fixture") return { mode, ...createFixtureProviderClients(firmableOptions), manufacturingDirectory: {
    search: (mandate: import("@/domain/models").Mandate, limit: number) => Promise.resolve(searchManufacturingBusinesses([
      { id: "fixture-packaging", name: "Example Packaging Equipment", website: "https://packaging.example", state: "QLD", categories: ["Manufacturing"], description: "Packaging equipment manufacturing", sourceRecords: [{ source: "Fictional register", sourceId: "packaging", sourceUrl: "https://register.example/packaging" }] },
      { id: "fixture-distribution", name: "Example Specialist Distribution", state: "NSW", categories: ["Wholesale"], description: "Specialist distribution", sourceRecords: [{ source: "Fictional register", sourceId: "distribution", sourceUrl: "https://register.example/distribution" }] },
    ], mandate, limit)),
  } };
  return { mode, places: new GooglePlacesClient(), firmable: new FirmableClient(firmableOptions), manufacturingDirectory };
}
