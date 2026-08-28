// ABOUTME: Resolves short links and mints new ones for a single trusted caller.
// ABOUTME: The mint route is the only write path and is guarded by one service token.

import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, validateDestination } from "./allowlist";
import { isCrawler } from "./crawler";
import { renderPreviewHtml, type LinkRecord } from "./og";
import { deriveSlug } from "./slug";

export interface Env {
  readonly LINKS: KVNamespace;
  readonly MINT_TOKEN: string;
}

const MINT_PATH = "/api/links";
/** How long a resolved link may keep serving after its record changes.
 *  Applies twice, to the KV edge read and to the json response, so the worst case is double this. */
const CACHE_SECONDS = 1800;
const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 200;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function clamp(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

async function mint(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.MINT_TOKEN || request.headers.get("authorization") !== `Bearer ${env.MINT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: { url?: unknown; title?: unknown; description?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof payload.url !== "string") return json({ error: "invalid_json" }, 400);

  const destination = validateDestination(payload.url);
  if (!destination) return json({ error: "destination_rejected" }, 422);

  const record: LinkRecord = {
    destination,
    title: clamp(payload.title, TITLE_MAX_LENGTH, DEFAULT_TITLE),
    description: clamp(payload.description, DESCRIPTION_MAX_LENGTH, DEFAULT_DESCRIPTION),
  };

  // The whole record is hashed, so two callers describing the same destination differently get two
  // links instead of silently overwriting each other.
  const slug = await deriveSlug([record.destination, record.title, record.description].join("\n"));
  await env.LINKS.put(slug, JSON.stringify(record));

  return json({ short_url: `${origin}/${slug}` }, 200);
}

async function resolve(slug: string, request: Request, url: URL, env: Env): Promise<Response> {
  const record = await env.LINKS.get<LinkRecord>(slug, { type: "json", cacheTtl: CACHE_SECONDS });
  if (!record) return new Response("Not found", { status: 404 });

  // `?format=json` rather than Accept negotiation: it is its own cache key, so one url can never
  // serve a cached json body to someone who wanted the redirect.
  if (url.searchParams.get("format") === "json") {
    return json({ slug, ...record }, 200, {
      "access-control-allow-origin": "*",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    });
  }

  if (isCrawler(request.headers.get("user-agent"))) {
    return new Response(renderPreviewHtml(record), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return Response.redirect(record.destination, 302);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === MINT_PATH) return mint(request, env, url.origin);
    if (url.pathname === "/health") return new Response("ok");

    const slug = url.pathname.slice(1);
    if (!slug || slug.includes("/")) return new Response("Not found", { status: 404 });
    return resolve(slug, request, url, env);
  },
} satisfies ExportedHandler<Env>;
