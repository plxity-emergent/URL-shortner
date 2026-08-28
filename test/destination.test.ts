import { describe, expect, it } from "vitest";

import { validateDestination } from "../src/destination";
import type { Namespace } from "../src/namespaces";

const SIMPLE: Namespace = {
  destination: [{ kind: "origin", origin: "https://app.example.com" }],
  callers: ["proxy"],
  defaultTitle: "t",
  defaultDescription: "d",
};

const LABELED: Namespace = {
  destination: [
    { kind: "labeled", label: "assets", apexes: ["example.com", "example.net"], envLabels: ["staging", "dev"] },
  ],
  callers: ["proxy"],
  defaultTitle: "t",
  defaultDescription: "d",
};

const WRAPPER: Namespace = {
  destination: [{ kind: "origin", origin: "https://app.example.com" }],
  path: "/view",
  inner: {
    param: "src",
    rules: [{ kind: "labeled", label: "assets", apexes: ["example.com"], envLabels: [] }],
  },
  callers: ["proxy"],
  defaultTitle: "t",
  defaultDescription: "d",
};

describe("validateDestination", () => {
  it("accepts an exact origin", () => {
    expect(validateDestination("https://app.example.com/x", SIMPLE)).toBe("https://app.example.com/x");
  });

  it("rejects a different origin", () => {
    expect(validateDestination("https://evil.example/x", SIMPLE)).toBeNull();
  });

  it("rejects plain http", () => {
    expect(validateDestination("http://app.example.com/x", SIMPLE)).toBeNull();
  });

  it("rejects junk instead of throwing", () => {
    expect(validateDestination("not a url", SIMPLE)).toBeNull();
  });

  it("accepts a bare labeled host and a suffixed one", () => {
    expect(validateDestination("https://assets.example.com/f", LABELED)).not.toBeNull();
    expect(validateDestination("https://assets-7f3.staging.example.net/f", LABELED)).not.toBeNull();
  });

  it("rejects a look-alike apex", () => {
    expect(validateDestination("https://assets.example.com.evil.test/f", LABELED)).toBeNull();
  });

  it("rejects an unlisted environment label", () => {
    expect(validateDestination("https://assets-x.tenant.example.com/f", LABELED)).toBeNull();
  });

  it("rejects a label that only shares a prefix", () => {
    expect(validateDestination("https://assetshub.example.com/f", LABELED)).toBeNull();
  });

  it("enforces an exact path when the namespace sets one", () => {
    const good = `https://app.example.com/view?src=${encodeURIComponent("https://assets.example.com/f")}`;
    const badPath = `https://app.example.com/other?src=${encodeURIComponent("https://assets.example.com/f")}`;
    expect(validateDestination(good, WRAPPER)).not.toBeNull();
    expect(validateDestination(badPath, WRAPPER)).toBeNull();
  });

  it("validates the inner target of a wrapper destination", () => {
    const badInner = `https://app.example.com/view?src=${encodeURIComponent("https://evil.example/f")}`;
    const missing = "https://app.example.com/view";
    expect(validateDestination(badInner, WRAPPER)).toBeNull();
    expect(validateDestination(missing, WRAPPER)).toBeNull();
  });
});
