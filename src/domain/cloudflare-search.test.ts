import { expect, it } from "vitest";
import { searchResultUrls } from "./cloudflare-search";
it("unwraps search result links before stripping tracking and ignores snippets, navigation and unsafe URLs", () => {
  const page = '## [Example](https://duckduckgo.com/l/?uddg=https%3A%2F%2Finstruments.example.com%2F%3Ftrack%3D1&rut=abc)\n[snippet](https://ignored.example.com/)\n## [Again](https://instruments.example.com/)\n## [Unsafe](https://127.0.0.1/)\n## [Nav](https://duckduckgo.com/html/)';
  expect(searchResultUrls(page)).toEqual(["https://instruments.example.com/"]);
});
it("caps seeds and handles blocked pages", () => {
  expect(searchResultUrls("Please complete the captcha")).toEqual([]);
  expect(searchResultUrls(Array.from({length: 10}, (_, i) => `## [result](https://supplier${i}.example.com/)`).join("\n"))).toHaveLength(6);
});
