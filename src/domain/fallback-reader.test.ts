import { expect, it, vi } from "vitest";
import { readFallback } from "../../cloudflare/research/fallback";
it("uses the authenticated configured reader and rejects empty or private redirect content", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ url: "https://instruments.example.com/", markdown: "Example Instruments manufactures sensors for industrial customers." })).mockResolvedValueOnce(Response.json({url:"https://127.0.0.1/",markdown:"Private internal configuration and sensitive contents"}));
  expect(await readFallback("https://instruments.example.com/","https://reader.example.com","test-secret",fetcher)).toMatchObject({status:"completed"});
  expect(await readFallback("https://instruments.example.com/","https://reader.example.com","test-secret",fetcher)).toMatchObject({status:"failed"});
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({authorization:"Bearer test-secret"});
  await readFallback("https://127.0.0.1/","https://reader.example.com","test-secret",fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
