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

  it("emits no title tags at all when there is no title", () => {
    const html = renderPreviewHtml({ ...RECORD, title: null });
    expect(html).not.toContain("og:title");
    expect(html).not.toContain("twitter:title");
    expect(html).not.toContain("<title>");
  });

  it("emits no description tags at all when there is none", () => {
    const html = renderPreviewHtml({ ...RECORD, description: null });
    expect(html).not.toContain("og:description");
    expect(html).not.toContain("twitter:description");
  });

  it("still names the destination and redirects when nothing is supplied", () => {
    const html = renderPreviewHtml({ ...RECORD, title: null, description: null });
    expect(html).toContain(`property="og:url" content="${RECORD.destination}"`);
    expect(html).toContain(`content="0; url=${RECORD.destination}"`);
  });

  it("escapes card text rather than trusting it", () => {
    const html = renderPreviewHtml({ ...RECORD, title: '"><script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
