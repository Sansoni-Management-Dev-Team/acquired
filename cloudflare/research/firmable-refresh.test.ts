import { expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {}, DurableObject: class {} }));
import { FirmableRefresh } from "./index";

it("stops after an acknowledged provider failure without retrying or searching people", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json(body.action === "company" ? { failed: true } : { ok: true });
  });
  const workflow = Object.assign(new FirmableRefresh(), {
    env: { APP_ORIGIN: "https://app.example", SERVICE_SECRET: "test" },
  });
  const names: string[] = [];
  const step = { do: vi.fn(async (name: string, _options: unknown, callback: () => Promise<string>) => {
    names.push(name);
    return callback();
  }) };
  try {
    const result = await workflow.run(
      { payload: { runId: "run", mandateId: "mandate" } } as Parameters<FirmableRefresh["run"]>[0],
      step as unknown as Parameters<FirmableRefresh["run"]>[1],
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(names).toEqual(["company", "fail"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    fetcher.mockRestore();
  }
});
