import { describe, expect, it } from "vitest";

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
