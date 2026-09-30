import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanyDataAction } from "./mandate-workspace";

describe("company data action", () => {
  it("stays visible and disabled when nothing is selected", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={0} busy={false} onClick={vi.fn()} />);

    expect(html).toContain("Enrich selected companies →");
    expect(html).toContain("disabled");
  });

  it("enables enrichment once companies are selected", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={2} busy={false} onClick={vi.fn()} />);

    expect(html).toContain("Enrich selected companies →");
    expect(html).not.toContain('disabled=""');
  });
  it("explains the 20-business limit when all matching businesses exceed it", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={25} busy={false} onClick={vi.fn()} />);
    expect(html).toContain("Select 20 or fewer businesses (25 selected)");
    expect(html).toContain("disabled");
  });
});
