import { describe, expect, it } from "vitest";

import { deriveSlug } from "../src/slug";

describe("deriveSlug", () => {
  it("is deterministic, so minting the same record twice reuses one slug", async () => {
    expect(await deriveSlug("docs\nhttps://example.com/a")).toBe(await deriveSlug("docs\nhttps://example.com/a"));
  });

  it("separates different records", async () => {
    expect(await deriveSlug("docs\nhttps://example.com/a")).not.toBe(await deriveSlug("docs\nhttps://example.com/b"));
  });

  it("separates the same url in different namespaces", async () => {
    expect(await deriveSlug("docs\nhttps://example.com/a")).not.toBe(await deriveSlug("blog\nhttps://example.com/a"));
  });

  it("is 12 url-safe characters with no padding", async () => {
    const slug = await deriveSlug("docs\nhttps://example.com/a");
    expect(slug).toHaveLength(12);
    expect(slug).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
});
