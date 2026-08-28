// ABOUTME: Resolves short links and mints new ones for a single trusted caller.
// ABOUTME: The mint route is the only write path and is guarded by one service token.

import { validateDestination } from "./allowlist";
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
/** Probes to try past a collision before failing. Four is far beyond what a 2^72 keyspace makes
 *  plausible; it exists so a pathological case fails loudly rather than overwriting someone. */
const MAX_PROBES = 4;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Null for anything absent or blank. Nothing is substituted on the caller's behalf. */
function clamp(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function isSameRecord(a: LinkRecord, b: LinkRecord): boolean {
  return a.destination === b.destination && a.title === b.title && a.description === b.description;
}

/**
 * Finds this record's slug: its own entry if it has one, otherwise the first free slot on its
 * probe sequence.
 *
 * The sequence is derived from the record, so a re-mint retraces the same steps and lands on the
 * same slug. That is what keeps minting idempotent without a reverse index. It also means an
 * unchanged re-mint costs one read and no write, which is cheaper than the blind put it replaced.
 *
 * The read cannot be made fully fresh: KV caches for at least 60 seconds, so two mints colliding
 * inside that window can still both see an empty slot and both write. This catches collisions
 * against settled links, which is nearly all of them in practice, not the concurrent case. There
 * is no put-if-absent on KV, so the concurrent case cannot be closed here at all.
 */
async function claimSlug(env: Env, record: LinkRecord): Promise<string | null> {
  // The whole record is hashed, so two callers describing the same destination differently get two
  // links rather than one of them silently winning.
  const canonical = [record.destination, record.title ?? "", record.description ?? ""].join("\n");

  for (let attempt = 0; attempt < MAX_PROBES; attempt++) {
    const slug = await deriveSlug(attempt === 0 ? canonical : `${canonical}\u0000${attempt}`);
    const existing = await env.LINKS.get<LinkRecord>(slug, { type: "json" });

    if (existing && !isSameRecord(existing, record)) continue;
    if (!existing) await env.LINKS.put(slug, JSON.stringify(record));
    return slug;
  }
  return null;
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
    title: clamp(payload.title, TITLE_MAX_LENGTH),
    description: clamp(payload.description, DESCRIPTION_MAX_LENGTH),
  };

  const slug = await claimSlug(env, record);
  if (!slug) return json({ error: "slug_exhausted" }, 500);

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
