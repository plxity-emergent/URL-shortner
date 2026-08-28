import { describe, expect, it } from "vitest";

import { renderPreviewHtml, type LinkRecord } from "../src/og";

const RECORD: LinkRecord = {
  destination: "https://customer-assets.emergentagent.com/a/b.mp4",
  title: "Quarterly report",
  description: "by the data team",
};

describe("renderPreviewHtml", () => {
  it("carries the card text a crawler needs", () => {
    const html = renderPreviewHtml(RECORD);
    expect(html).toContain('property="og:title" content="Quarterly report"');
    expect(html).toContain('property="og:description" content="by the data team"');
  });

  it("escapes card text rather than trusting it", () => {
    const html = renderPreviewHtml({ ...RECORD, title: '"><script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("still redirects a human who lands on the card", () => {
    expect(renderPreviewHtml(RECORD)).toContain(`content="0; url=${RECORD.destination}"`);
  });
});
