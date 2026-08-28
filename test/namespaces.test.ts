import { describe, expect, it } from "vitest";

import { validateDestination } from "../src/destination";
import { getNamespace, NAMESPACES } from "../src/namespaces";

describe("namespace registry", () => {
  it("returns null for an unknown id", () => {
    expect(getNamespace("nope")).toBeNull();
  });

  it("returns a registered namespace", () => {
    const namespace = getNamespace("example");
    expect(namespace).not.toBeNull();
    expect(namespace?.callers.length).toBeGreaterThan(0);
  });

  it("gives every namespace a non-empty caller list", () => {
    for (const [id, namespace] of Object.entries(NAMESPACES)) {
      expect(namespace.callers.length, `${id} has no callers`).toBeGreaterThan(0);
    }
  });

  it("gives every namespace at least one destination rule", () => {
    for (const [id, namespace] of Object.entries(NAMESPACES)) {
      expect(namespace.destination.length, `${id} has no destination rules`).toBeGreaterThan(0);
    }
  });

  it("gives every namespace a default title", () => {
    for (const [id, namespace] of Object.entries(NAMESPACES)) {
      expect(namespace.defaultTitle, `${id} has no default title`).toBeTruthy();
    }
  });
});

describe("the asset namespace", () => {
  const asset = getNamespace("asset")!;

  it("accepts a per-deployment suffixed host on either apex", () => {
    expect(validateDestination("https://customer-assets-39nsmqrw.emergentagent.net/a/b.mp4", asset)).not.toBeNull();
    expect(validateDestination("https://customer-assets.emergentagent.com/a/b.mp4", asset)).not.toBeNull();
  });

  it("accepts the listed environment labels", () => {
    expect(validateDestination("https://customer-assets-x.staging.emergentagent.net/f.mp4", asset)).not.toBeNull();
    expect(validateDestination("https://customer-assets-x.dev.emergentagent.com/f.mp4", asset)).not.toBeNull();
  });

  it("refuses preview subdomains, which serve user-controlled content", () => {
    expect(validateDestination("https://customer-assets-x.preview.emergentagent.com/f.mp4", asset)).toBeNull();
  });

  it("refuses a look-alike apex", () => {
    expect(validateDestination("https://customer-assets.emergentagent.com.evil.test/f.mp4", asset)).toBeNull();
  });

  it("refuses a label that merely starts the same way", () => {
    expect(validateDestination("https://customer-assetshub.emergentagent.com/f.mp4", asset)).toBeNull();
  });

  it("refuses plain http", () => {
    expect(validateDestination("http://customer-assets.emergentagent.com/f.mp4", asset)).toBeNull();
  });
});
