import { describe, expect, it } from "vitest";

import { renderPreviewHtml, type LinkRecord } from "../src/og";

const BASE: LinkRecord = {
  namespace: "example",
  destination: "https://example.com/page",
  title: "Quarterly report",
  description: "by the data team",
  image: null,
  caller: "proxy",
};

describe("renderPreviewHtml", () => {
  it("emits no image tags and a plain card when there is no image", () => {
    const html = renderPreviewHtml(BASE);
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it("emits both image tags and a large card when there is one", () => {
    const html = renderPreviewHtml({ ...BASE, image: "https://cdn.example.com/thumb.png" });
    expect(html).toContain('property="og:image" content="https://cdn.example.com/thumb.png"');
    expect(html).toContain('name="twitter:image" content="https://cdn.example.com/thumb.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("escapes an image url rather than trusting it", () => {
    const html = renderPreviewHtml({ ...BASE, image: 'https://cdn.example.com/a.png"><script>' });
    expect(html).not.toContain("<script>");
  });

  it("still redirects a human who lands on the card", () => {
    expect(renderPreviewHtml(BASE)).toContain('content="0; url=https://example.com/page"');
  });
});
