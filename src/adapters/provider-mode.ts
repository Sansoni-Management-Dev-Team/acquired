import { FirmableClient } from "./firmable-client";
import { createFixtureProviderClients } from "./fixture-provider";
import { GooglePlacesClient } from "./google-places-client";

export type TargetDataProviderMode = "fixture" | "live";

export function resolveTargetDataProviderMode(value: string | undefined): TargetDataProviderMode {
  if (value === "fixture" || value === "live") return value;
  throw new Error('TARGET_DATA_PROVIDER must be explicitly set to "fixture" or "live"');
}

export function createTargetDataProvider(mode = resolveTargetDataProviderMode(process.env.TARGET_DATA_PROVIDER)) {
  if (mode === "fixture") return { mode, ...createFixtureProviderClients() };
  return { mode, places: new GooglePlacesClient(), firmable: new FirmableClient() };
}
