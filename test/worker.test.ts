import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/index";

const TEST_ENV = {
  ...env,
  MINT_TOKENS: JSON.stringify({ proxy: "proxy-token", other: "other-token" }),
} as Env;

const DESTINATION = "https://example.com/page";

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, TEST_ENV, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function mintRequest(body: unknown, token = "proxy-token"): Request {
  return new Request("https://s.example.com/api/links", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function shortUrlFor(body: unknown): Promise<string> {
  const response = await call(mintRequest(body));
  const parsed = (await response.json()) as { short_url: string };
  return parsed.short_url;
}

describe("mint", () => {
  it("returns a short url and is idempotent", async () => {
    const body = { namespace: "example", url: DESTINATION, title: "A page" };
    expect(await shortUrlFor(body)).toBe(await shortUrlFor(body));
    expect(await shortUrlFor(body)).toMatch(/^https:\/\/s\.example\.com\/[A-Za-z0-9_-]{12}$/);
  });

  it("gives a different slug when the card text differs", async () => {
    const a = await shortUrlFor({ namespace: "example", url: DESTINATION, title: "A" });
    const b = await shortUrlFor({ namespace: "example", url: DESTINATION, title: "B" });
    expect(a).not.toBe(b);
  });

  it("rejects a missing or wrong token", async () => {
    expect((await call(mintRequest({ namespace: "example", url: DESTINATION }, "wrong"))).status).toBe(401);
  });

  it("rejects a caller not listed on the namespace", async () => {
    expect((await call(mintRequest({ namespace: "example", url: DESTINATION }, "other-token"))).status).toBe(403);
  });

  it("rejects an unknown namespace", async () => {
    expect((await call(mintRequest({ namespace: "nope", url: DESTINATION }))).status).toBe(422);
  });

  it("rejects a destination the namespace will not wrap", async () => {
    expect((await call(mintRequest({ namespace: "example", url: "https://evil.test/x" }))).status).toBe(422);
  });

  it("rejects a malformed body", async () => {
    expect((await call(mintRequest({ url: DESTINATION }))).status).toBe(400);
  });

  it("rejects a non-POST", async () => {
    expect((await call(new Request("https://s.example.com/api/links", { method: "GET" }))).status).toBe(405);
  });
});

describe("resolve", () => {
  async function mintAndSlug(title = "A page"): Promise<string> {
    const shortUrl = await shortUrlFor({ namespace: "example", url: DESTINATION, title });
    return new URL(shortUrl).pathname.slice(1);
  }

  it("redirects a browser to the destination", async () => {
    const slug = await mintAndSlug();
    const response = await call(
      new Request(`https://s.example.com/${slug}`, { headers: { "user-agent": "Mozilla/5.0 Chrome/128.0" } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DESTINATION);
  });

  it("serves open graph html to a crawler", async () => {
    const slug = await mintAndSlug("Quarterly report");
    const response = await call(
      new Request(`https://s.example.com/${slug}`, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } }),
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('property="og:title" content="Quarterly report"');
    // The example namespace declares no image rules, so no image survives to the card.
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it("escapes card text so a title cannot inject markup", async () => {
    const slug = await mintAndSlug('"><script>alert(1)</script>');
    const response = await call(
      new Request(`https://s.example.com/${slug}`, { headers: { "user-agent": "Twitterbot/1.0" } }),
    );
    expect(await response.text()).not.toContain("<script>alert(1)</script>");
  });

  it("returns the record as json when asked by query param", async () => {
    const slug = await mintAndSlug("Quarterly report");
    const response = await call(new Request(`https://s.example.com/${slug}?format=json`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      slug,
      namespace: "example",
      destination: DESTINATION,
      title: "Quarterly report",
      description: "Opens in your browser",
      image: null,
    });
  });

  it("returns the record as json when asked by accept header", async () => {
    const slug = await mintAndSlug("Via header");
    const response = await call(
      new Request(`https://s.example.com/${slug}`, { headers: { accept: "application/json" } }),
    );
    expect(response.status).toBe(200);
    expect((await response.json() as { title: string }).title).toBe("Via header");
  });

  it("varies on Accept, so a cached json body cannot be replayed to a browser", async () => {
    const slug = await mintAndSlug("Cacheable");
    const response = await call(new Request(`https://s.example.com/${slug}?format=json`));
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("cache-control")).toContain("max-age");
  });

  it("never exposes which caller minted the link", async () => {
    const slug = await mintAndSlug("Private attribution");
    const body = await (await call(new Request(`https://s.example.com/${slug}?format=json`))).json();
    expect(body).not.toHaveProperty("caller");
  });

  it("prefers an explicit json ask over user-agent sniffing", async () => {
    const slug = await mintAndSlug("Both signals");
    const response = await call(
      new Request(`https://s.example.com/${slug}?format=json`, {
        headers: { "user-agent": "Slackbot-LinkExpanding 1.0" },
      }),
    );
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("still redirects a browser that did not ask for json", async () => {
    const slug = await mintAndSlug("Plain");
    const response = await call(
      new Request(`https://s.example.com/${slug}`, { headers: { "user-agent": "Mozilla/5.0 Chrome/128.0" } }),
    );
    expect(response.status).toBe(302);
  });

  it("404s an unknown slug", async () => {
    expect((await call(new Request("https://s.example.com/doesnotexist"))).status).toBe(404);
  });

  it("answers health checks", async () => {
    expect((await call(new Request("https://s.example.com/health"))).status).toBe(200);
  });
});
