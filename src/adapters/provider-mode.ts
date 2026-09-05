import { FirmableClient } from "./firmable-client";
import { createFixtureProviderClients } from "./fixture-provider";
import { GooglePlacesClient } from "./google-places-client";
import { ManufacturingDirectoryClient } from "./manufacturing-directory-client";

export type TargetDataProviderMode = "fixture" | "live";

export function resolveTargetDataProviderMode(value: string | undefined): TargetDataProviderMode {
  if (value === "fixture" || value === "live") return value;
  throw new Error('TARGET_DATA_PROVIDER must be explicitly set to "fixture" or "live"');
}

export function createTargetDataProvider(mode = resolveTargetDataProviderMode(process.env.TARGET_DATA_PROVIDER)) {
  const manufacturingDirectory = new ManufacturingDirectoryClient();
  if (mode === "fixture") return { mode, ...createFixtureProviderClients(), manufacturingDirectory };
  return { mode, places: new GooglePlacesClient(), firmable: new FirmableClient(), manufacturingDirectory };
}
