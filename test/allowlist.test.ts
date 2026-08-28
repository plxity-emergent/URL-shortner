import { describe, expect, it } from "vitest";

import { validateDestination } from "../src/allowlist";

describe("validateDestination", () => {
  it("accepts a bare host and a per-deployment suffixed one, on either apex", () => {
    expect(validateDestination("https://customer-assets.emergentagent.com/a/b.mp4")).not.toBeNull();
    expect(validateDestination("https://customer-assets-39nsmqrw.emergentagent.net/a/b.mp4")).not.toBeNull();
  });

  it("accepts the listed environment labels", () => {
    expect(validateDestination("https://customer-assets-x.staging.emergentagent.net/f.mp4")).not.toBeNull();
    expect(validateDestination("https://customer-assets-x.dev.emergentagent.com/f.mp4")).not.toBeNull();
  });

  it("refuses preview subdomains, which serve user-controlled content", () => {
    expect(validateDestination("https://customer-assets-x.preview.emergentagent.com/f.mp4")).toBeNull();
  });

  it("refuses a look-alike apex", () => {
    expect(validateDestination("https://customer-assets.emergentagent.com.evil.test/f.mp4")).toBeNull();
  });

  it("refuses a label that merely starts the same way", () => {
    expect(validateDestination("https://customer-assetshub.emergentagent.com/f.mp4")).toBeNull();
  });

  it("refuses an unlisted environment label", () => {
    expect(validateDestination("https://customer-assets-x.tenant.emergentagent.com/f.mp4")).toBeNull();
  });

  it("refuses a wholly different host", () => {
    expect(validateDestination("https://evil.example/f.mp4")).toBeNull();
  });

  it("refuses plain http", () => {
    expect(validateDestination("http://customer-assets.emergentagent.com/f.mp4")).toBeNull();
  });

  it("refuses junk instead of throwing", () => {
    expect(validateDestination("not a url")).toBeNull();
    expect(validateDestination("javascript:alert(1)")).toBeNull();
  });
});
