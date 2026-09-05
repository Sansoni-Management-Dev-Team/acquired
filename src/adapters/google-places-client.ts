import { z } from "zod";
import type { ManufacturingDirectorySourceData } from "@/domain/models";

export const MAX_BUSINESS_RESULTS = 20;
export const businessResultLimitSchema = z.union([
  z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal("max"),
]);
export type BusinessResultLimit = z.infer<typeof businessResultLimitSchema>;

const placeSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string(), languageCode: z.string().optional() }),
  formattedAddress: z.string().optional(),
  websiteUri: z.string().url().optional(),
  primaryType: z.string().optional(),
  types: z.array(z.string()).optional(),
  addressComponents: z.array(z.object({
    longText: z.string(),
    shortText: z.string(),
    types: z.array(z.string()),
  })).optional(),
}).passthrough();

const placesResponseSchema = z.object({ places: z.array(placeSchema).default([]) }).passthrough();

export type GooglePlaceCandidate = {
  id: string;
  name: string;
  formattedAddress: string;
  website?: string;
  primaryType?: string;
  types?: string[];
  locality?: string;
  state?: string;
  discoverySource?: "google-places" | "manufacturing-directory";
  manufacturingDirectory?: ManufacturingDirectorySourceData;
};

export class GooglePlacesError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type GooglePlacesClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

export function resolveBusinessResultLimit(limit: BusinessResultLimit) {
  return limit === "max" ? MAX_BUSINESS_RESULTS : limit;
}

export class GooglePlacesClient {
  private apiKey: string;
  private baseUrl: string;
  private fetcher: typeof globalThis.fetch;

  constructor(options: GooglePlacesClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.GOOGLE_PLACES_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.GOOGLE_PLACES_BASE_URL || "https://places.googleapis.com/v1";
    this.fetcher = options.fetch || globalThis.fetch;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async searchText(textQuery: string, limit: BusinessResultLimit): Promise<GooglePlaceCandidate[]> {
    if (!this.apiKey) throw new GooglePlacesError(0, "Google Places is not configured");
    const pageSize = resolveBusinessResultLimit(limit);
    const response = await this.fetcher(`${this.baseUrl}/places:searchText`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.primaryType,places.types,places.addressComponents",
      },
      body: JSON.stringify({ textQuery, pageSize, languageCode: "en", regionCode: "AU" }),
    });
    if (!response.ok) throw new GooglePlacesError(response.status, `Google Places request failed (${response.status})`);
    const parsed = placesResponseSchema.parse(await response.json());
    return parsed.places.slice(0, pageSize).map((place) => {
      const locality = place.addressComponents?.find((component) => component.types.includes("locality") || component.types.includes("postal_town"));
      const state = place.addressComponents?.find((component) => component.types.includes("administrative_area_level_1"));
      return {
        id: place.id,
        name: place.displayName.text,
        formattedAddress: place.formattedAddress || "Australia",
        website: place.websiteUri,
        primaryType: place.primaryType,
        types: place.types || [],
        locality: locality?.longText,
        state: state?.shortText,
        discoverySource: "google-places",
      };
    });
  }
}
