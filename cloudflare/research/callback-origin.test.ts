import { expect, it } from "vitest";
import { callbackOrigin } from "./callback-origin";
it("allows local callbacks only in explicit local mode", () => {
  expect(callbackOrigin("http://127.0.0.1:3010", true)).toBe("http://127.0.0.1:3010");
  expect(() => callbackOrigin("http://localhost:3010")).toThrow();
  expect(() => callbackOrigin("http://external.example.com", true)).toThrow();
  expect(() => callbackOrigin("https://project-acquire.vercel.app", true)).toThrow();
  expect(callbackOrigin("https://project-acquire.vercel.app")).toBe("https://project-acquire.vercel.app");
});
