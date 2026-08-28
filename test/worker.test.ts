import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { deriveSlug } from "../src/slug";
import type { Env } from "../src/index";

const TEST_ENV = { ...env, MINT_TOKEN: "test-token" } as Env;
const DESTINATION = "https://customer-assets.emergentagent.com/wingman/a/attachments/b.mp4";

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, TEST_ENV, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function mintRequest(body: unknown, token = "test-token"): Request {
  return new Request("https://s.example.com/api/links", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function shortUrlFor(body: unknown): Promise<string> {
  const response = await call(mintRequest(body));
  return ((await response.json()) as { short_url: string }).short_url;
}

async function slugFor(title = "A page"): Promise<string> {
  const shortUrl = await shortUrlFor({ url: DESTINATION, title });
  return new URL(shortUrl).pathname.slice(1);
}

describe("mint", () => {
  it("returns a short url and is idempotent", async () => {
    const body = { url: DESTINATION, title: "A page" };
    expect(await shortUrlFor(body)).toBe(await shortUrlFor(body));
    expect(await shortUrlFor(body)).toMatch(/^https:\/\/s\.example\.com\/[A-Za-z0-9_-]{12}$/);
  });

  it("gives a different slug when the card text differs", async () => {
    expect(await shortUrlFor({ url: DESTINATION, title: "A" })).not.toBe(
      await shortUrlFor({ url: DESTINATION, title: "B" }),
    );
  });

  it("leaves card text null rather than inventing it", async () => {
    const slug = new URL(await shortUrlFor({ url: DESTINATION })).pathname.slice(1);
    const body = await (await call(new Request(`https://s.example.com/${slug}?format=json`))).json();
    expect(body).toMatchObject({ title: null, description: null });
  });

  it("treats a blank title as absent", async () => {
    const slug = new URL(await shortUrlFor({ url: DESTINATION, title: "   " })).pathname.slice(1);
    const body = (await (await call(new Request(`https://s.example.com/${slug}?format=json`))).json()) as {
      title: string | null;
    };
    expect(body.title).toBeNull();
  });

  it("rejects a missing or wrong token", async () => {
    expect((await call(mintRequest({ url: DESTINATION }, "wrong"))).status).toBe(401);
  });

  it("rejects a destination off the allowlist", async () => {
    expect((await call(mintRequest({ url: "https://evil.test/x" }))).status).toBe(422);
  });

  it("rejects a body with no url", async () => {
    expect((await call(mintRequest({ title: "orphan" }))).status).toBe(400);
  });

  it("rejects a non-POST", async () => {
    expect((await call(new Request("https://s.example.com/api/links", { method: "GET" }))).status).toBe(405);
  });

  describe("collisions", () => {
    const LINKS = (env as unknown as Env).LINKS;

    /** The slug a record lands on before any probing. */
    async function firstSlugFor(title: string): Promise<string> {
      return deriveSlug([DESTINATION, title, ""].join("\n"));
    }

    it("probes past a collision instead of overwriting someone else's link", async () => {
      const squatted = await firstSlugFor("Colliding");
      const squatter = {
        destination: "https://customer-assets.emergentagent.com/someone/else.mp4",
        title: "Not yours",
        description: "d",
      };
      await LINKS.put(squatted, JSON.stringify(squatter));

      const slug = new URL(await shortUrlFor({ url: DESTINATION, title: "Colliding" })).pathname.slice(1);

      expect(slug).not.toBe(squatted);
      expect(await LINKS.get(squatted, { type: "json" })).toEqual(squatter);
    });

    it("stays idempotent after probing, retracing the same sequence", async () => {
      const squatted = await firstSlugFor("Still colliding");
      await LINKS.put(
        squatted,
        JSON.stringify({ destination: "https://customer-assets.emergentagent.com/x.mp4", title: "t", description: "d" }),
      );

      const body = { url: DESTINATION, title: "Still colliding" };
      expect(await shortUrlFor(body)).toBe(await shortUrlFor(body));
    });

    it("fails loudly rather than overwriting when every probe is taken", async () => {
      const canonical = [DESTINATION, "Hopeless", ""].join("\n");
      const blocker = { destination: "https://customer-assets.emergentagent.com/b.mp4", title: "b", description: "b" };
      for (let attempt = 0; attempt < 4; attempt++) {
        const slug = await deriveSlug(attempt === 0 ? canonical : `${canonical}\u0000${attempt}`);
        await LINKS.put(slug, JSON.stringify(blocker));
      }

      const response = await call(mintRequest({ url: DESTINATION, title: "Hopeless" }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "slug_exhausted" });
    });
  });
});

describe("resolve", () => {
  it("redirects a browser to the destination", async () => {
    const slug = await slugFor();
    const response = await call(
      new Request(`https://s.example.com/${slug}`, { headers: { "user-agent": "Mozilla/5.0 Chrome/128.0" } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DESTINATION);
  });

  it("serves open graph html to a crawler", async () => {
    const slug = await slugFor("Quarterly report");
    const response = await call(
      new Request(`https://s.example.com/${slug}`, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('property="og:title" content="Quarterly report"');
  });

  it("returns the record as json on ?format=json", async () => {
    const slug = await slugFor("Quarterly report");
    const response = await call(new Request(`https://s.example.com/${slug}?format=json`));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      slug,
      destination: DESTINATION,
      title: "Quarterly report",
      description: null,
    });
  });

  it("still redirects a crawler that asked for json, since the query wins", async () => {
    const slug = await slugFor("Both signals");
    const response = await call(
      new Request(`https://s.example.com/${slug}?format=json`, {
        headers: { "user-agent": "Slackbot-LinkExpanding 1.0" },
      }),
    );
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("404s an unknown slug", async () => {
    expect((await call(new Request("https://s.example.com/doesnotexist"))).status).toBe(404);
  });

  it("answers health checks", async () => {
    expect((await call(new Request("https://s.example.com/health"))).status).toBe(200);
  });
});
