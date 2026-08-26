import { z } from "zod";
import type { Mandate } from "@/domain/models";

const organizationSchema = z.object({ id: z.string(), name: z.string(), website_url: z.string().nullable().optional(), primary_domain: z.string().nullable().optional(), estimated_num_employees: z.number().nullable().optional() }).passthrough();
const searchSchema = z.object({ organizations: z.array(organizationSchema).default([]) }).passthrough();

export class ApolloClient {
  constructor(private apiKey = process.env.APOLLO_API_KEY || "", private fetcher: typeof fetch = fetch) {}
  async searchCompanies(mandate: Mandate) {
    if (!this.apiKey) throw new Error("Apollo is not configured");
    const response = await this.fetcher("https://api.apollo.io/api/v1/mixed_companies/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": this.apiKey },
      body: JSON.stringify({ organization_locations: mandate.states.map((state) => `${state}, Australia`), organization_num_employees_ranges: mandate.headcount ? [`${mandate.headcount.min},${mandate.headcount.max}`] : undefined, q_organization_keyword_tags: mandate.sectors, page: 1, per_page: 25 }),
    });
    if (!response.ok) throw new Error(`Apollo company search failed (${response.status})`);
    return searchSchema.parse(await response.json()).organizations;
  }
}
