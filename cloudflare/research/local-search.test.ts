import { expect, it } from "vitest";
import { localSearchEndpoint, normaliseLocalSearch } from "./local-search";
it("only runs against the loopback OpenSERP container in local development", () => {
  expect(localSearchEndpoint({ LOCAL_DEVELOPMENT: "true", LOCAL_SEARCH_URL: "http://127.0.0.1:7000" })).toBe("http://127.0.0.1:7000/duckduckgo/search");
  expect(localSearchEndpoint({ LOCAL_DEVELOPMENT: "false", LOCAL_SEARCH_URL: "http://127.0.0.1:7000" })).toBeNull();
  expect(localSearchEndpoint({ LOCAL_DEVELOPMENT: "true" })).toBeNull();
  expect(() => localSearchEndpoint({ LOCAL_DEVELOPMENT: "true", LOCAL_SEARCH_URL: "https://search.example.com" })).toThrow();
});
it("normalises results, keeps snippets verbatim and drops redirect wrappers and duplicates", () => {
  const results = normaliseLocalSearch({ results: [
    { title: "Example  Co", url: "https://profiles.example.net/company/example-co", snippet: "Example Co employs  40 employees." },
    { title: "Wrapped", url: "https://www.google.com/goto?url=abc", snippet: "hidden" },
    { title: "Dup", url: "https://profiles.example.net/company/example-co/", snippet: "again" },
    { title: "Private", url: "http://10.0.0.1/x", snippet: "no" },
  ] });
  expect(results).toEqual([{ url: "https://profiles.example.net/company/example-co", title: "Example Co", snippet: "Example Co employs 40 employees." }]);
});
