import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDatabaseConfig } from "./driver";

describe("resolveDatabaseConfig", () => {
  afterEach(() => vi.restoreAllMocks());

  it("selects node-postgres when explicitly configured", () => {
    expect(resolveDatabaseConfig({
      DATABASE_DRIVER: "postgres",
      DATABASE_URL: "postgresql://local-user:local-password@127.0.0.1:5434/project_acquire",
      NODE_ENV: "development",
    })).toEqual({
      driver: "postgres",
      connectionString: "postgresql://local-user:local-password@127.0.0.1:5434/project_acquire",
    });
  });

  it("selects Neon HTTP when explicitly configured", () => {
    expect(resolveDatabaseConfig({
      DATABASE_DRIVER: "neon",
      DATABASE_URL: "postgresql://remote-user:remote-password@example.neon.tech/acquired",
      NODE_ENV: "development",
    })?.driver).toBe("neon");
  });

  it("requires a driver when a URL is configured", () => {
    expect(() => resolveDatabaseConfig({
      DATABASE_URL: "postgresql://user:secret@localhost/database",
      NODE_ENV: "development",
    })).toThrow('DATABASE_DRIVER is required when DATABASE_URL is configured; use "postgres" or "neon"');
  });

  it("rejects an invalid driver", () => {
    expect(() => resolveDatabaseConfig({
      DATABASE_DRIVER: "http",
      DATABASE_URL: "postgresql://user:secret@localhost/database",
      NODE_ENV: "development",
    })).toThrow('DATABASE_DRIVER must be either "postgres" or "neon"');
  });

  it("fails closed in production without a URL", () => {
    expect(() => resolveDatabaseConfig({
      DATABASE_DRIVER: "neon",
      NODE_ENV: "production",
    })).toThrow("DATABASE_URL is required in production");
  });

  it("allows an unconfigured database outside production", () => {
    expect(resolveDatabaseConfig({ NODE_ENV: "test" })).toBeNull();
  });

  it("does not print connection strings or errors", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secretUrl = "postgresql://user:do-not-print@localhost/database";

    expect(() => resolveDatabaseConfig({
      DATABASE_DRIVER: "invalid",
      DATABASE_URL: secretUrl,
      NODE_ENV: "development",
    })).toThrow();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
