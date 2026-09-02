import { describe, expect, it, vi } from "vitest";
import { ApolloClient } from "./apollo-client";
import { defaultMandate } from "@/test/fixtures/scoring-targets";

describe("ApolloClient", () => {
  it("maps a company search without exposing credentials", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
      return new Response(JSON.stringify({ organizations: [{ id: "a1", name: "Example Co", primary_domain: "example.com" }] }), { status: 200 });
    });
    const results = await new ApolloClient("test-key", fetcher).searchCompanies(defaultMandate);
    expect(results[0]).toMatchObject({ id: "a1", name: "Example Co" });
  });
});
