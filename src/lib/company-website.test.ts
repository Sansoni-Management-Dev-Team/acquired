import { describe, expect, it, vi } from "vitest";
import { publicIpAddress, validateCompanyWebsite } from "./company-website";

const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("company website validation", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:7f00:1", "fd00::1", "fe80::1"])("blocks non-public address %s", address => {
    expect(publicIpAddress(address)).toBe(false);
  });

  it("accepts a successful public HTTPS site and follows a safe redirect", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 301, location: "https://www.example.com/" })
      .mockResolvedValueOnce({ status: 200 });
    await expect(validateCompanyWebsite("https://example.com/", { resolve, request })).resolves.toEqual({ ok: true, url: "https://www.example.com/", status: 200 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects DNS failures, private destinations and non-success responses", async () => {
    await expect(validateCompanyWebsite("https://missing.example.com/", { resolve: async () => { throw new Error("ENOTFOUND"); } })).resolves.toMatchObject({ ok: false, reason: "Website domain does not resolve" });
    await expect(validateCompanyWebsite("https://private.example.com/", { resolve: async () => [{ address: "10.0.0.1", family: 4 }] })).resolves.toMatchObject({ ok: false, reason: "Website does not resolve to a public address" });
    await expect(validateCompanyWebsite("https://example.com/", { resolve, request: async () => ({ status: 404 }) })).resolves.toMatchObject({ ok: false, status: 404 });
  });
});
