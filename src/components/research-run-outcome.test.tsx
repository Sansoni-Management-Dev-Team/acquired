import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResearchRunOutcome } from "./research-run-outcome";

function render(overrides: Partial<React.ComponentProps<typeof ResearchRunOutcome>> = {}) {
  const onResume = vi.fn();
  const html = renderToStaticMarkup(<ResearchRunOutcome status="cancelled" remaining={6} active={false} canResume busy={false} onResume={onResume} {...overrides} />);
  return { html, onResume };
}

describe("research outcome shown for saved unfinished URLs", () => {
  it("explains the cancelled six-URL run and makes resumption an explicit choice", () => {
    const { html, onResume } = render();
    expect(html).toContain("Research cancelled — 6 URLs remaining");
    expect(html).toContain("Automatic research stopped when this run was cancelled");
    expect(html).toContain("Resume cancelled research");
    expect(html).not.toContain("Continue research");
    expect(html).not.toContain("This run has stopped");
    expect(onResume).not.toHaveBeenCalled();
  });
  it("does not present a finished batch as stopped while continuation is active", () => {
    expect(render({ status: "partial", active: true }).html).toBe("");
  });
  it.each(["queued", "discovering", "reading"])("does not show a resume action for a %s job", status => {
    expect(render({ status }).html).toBe("");
  });
  it("distinguishes failure from cancellation and makes the error discoverable", () => {
    const { html } = render({ status: "failed" });
    expect(html).toContain("Research failed — 6 URLs remaining");
    expect(html).toContain("You can retry the run");
    expect(html).not.toContain("cancelled");
  });
  it("does not call a completed run paused just because unused URLs remain", () => {
    const { html } = render({ status: "complete" });
    expect(html).toContain("Research complete — 6 URLs remaining");
    expect(html).not.toContain("Research paused");
  });
  it("names a completed run that stopped below its business goal", () => {
    const { html } = render({ status: "complete", goal: 20, saved: 7 });
    expect(html).toContain("Research finished below goal");
    expect(html).toContain("7 of 20 new businesses were saved");
  });
  it("keeps manual continuation available for partial runs", () => {
    const { html } = render({ status: "partial", remaining: 1 });
    expect(html).toContain("Research paused — 1 URL remaining");
    expect(html).toContain("Continue research");
  });
  it("does not offer to resume an empty queue or an unsupported enrichment job", () => {
    expect(render({ remaining: 0 }).html).not.toContain("<button");
    expect(render({ canResume: false }).html).not.toContain("<button");
  });
  it("disables resumption while a request is pending", () => {
    expect(render({ busy: true }).html).toContain('disabled=""');
  });
});
