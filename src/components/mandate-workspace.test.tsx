import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanyDataAction } from "./mandate-workspace";

describe("company data action", () => {
  it("stays visible and prompts for a company when nothing is selected", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={0} busy={false} onClick={vi.fn()} />);

    expect(html).toContain("Please select a company(s) first");
    expect(html).toContain("disabled");
  });

  it("shows the enrichment action and selection count once companies are selected", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={2} busy={false} onClick={vi.fn()} />);

    expect(html).toContain("Find more company data (2/20)");
    expect(html).not.toContain('disabled=""');
  });
  it("explains the 20-business limit when all matching businesses exceed it", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={25} busy={false} onClick={vi.fn()} />);
    expect(html).toContain("Select 20 or fewer businesses (25 selected)");
    expect(html).toContain("disabled");
  });
});
