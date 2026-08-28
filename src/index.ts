// ABOUTME: Resolves short links and mints new ones for authorized callers.
// ABOUTME: The mint route is the only write path and is guarded by named service tokens.

import { isCrawler } from "./crawler";
import { validateDestination, validateImage } from "./destination";
import { getNamespace } from "./namespaces";
import { renderPreviewHtml, type LinkRecord } from "./og";
import { deriveSlug } from "./slug";

export interface Env {
  readonly LINKS: KVNamespace;
  /** JSON object mapping caller name to its mint token. */
  readonly MINT_TOKENS: string;
}

const MINT_PATH = "/api/links";
/** A revoked link can still resolve at an already-warm PoP for this long. */
const RESOLVE_CACHE_TTL_SECONDS = 300;
const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 200;

interface MintPayload {
  namespace?: unknown;
  url?: unknown;
  title?: unknown;
  description?: unknown;
  image?: unknown;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Resolves a bearer token to the caller's name, or null when it matches nothing. */
function callerFor(request: Request, env: Env): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const presented = header.slice("Bearer ".length);
  if (!presented) return null;

  let tokens: Record<string, string>;
  try {
    tokens = JSON.parse(env.MINT_TOKENS ?? "{}");
  } catch {
    return null;
  }
  const match = Object.entries(tokens).find(([, token]) => token === presented);
  return match ? match[0] : null;
}

function clamp(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

async function mint(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerFor(request, env);
  if (!caller) return json({ error: "unauthorized" }, 401);

  let payload: MintPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof payload.namespace !== "string" || typeof payload.url !== "string") {
    return json({ error: "invalid_json" }, 400);
  }

  const namespace = getNamespace(payload.namespace);
  if (!namespace) return json({ error: "unknown_namespace" }, 422);
  if (!namespace.callers.includes(caller)) return json({ error: "caller_not_permitted" }, 403);

  const destination = validateDestination(payload.url, namespace);
  if (!destination) return json({ error: "destination_rejected" }, 422);

  // A caller-supplied image failing the namespace rules is dropped, not fatal: a bad thumbnail
  // should cost a thumbnail, not the link. A namespace with no image rules never carries one.
  const image = typeof payload.image === "string" ? validateImage(payload.image, namespace) : null;

  const record: LinkRecord = {
    namespace: payload.namespace,
    destination,
    title: clamp(payload.title, TITLE_MAX_LENGTH, namespace.defaultTitle),
    description: clamp(payload.description, DESCRIPTION_MAX_LENGTH, namespace.defaultDescription),
    image,
    caller,
  };

  // The canonical string covers everything the card shows, so two callers describing the same
  // destination differently get two links instead of silently overwriting each other.
  const slug = await deriveSlug(
    [record.namespace, record.destination, record.title, record.description, record.image ?? ""].join("\n"),
  );
  await env.LINKS.put(slug, JSON.stringify(record));

  return json({ short_url: `${origin}/${slug}` }, 200);
}

async function resolve(slug: string, request: Request, env: Env): Promise<Response> {
  const record = await env.LINKS.get<LinkRecord>(slug, {
    type: "json",
    cacheTtl: RESOLVE_CACHE_TTL_SECONDS,
  });
  if (!record) return new Response("Not found", { status: 404 });

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
    return resolve(slug, request, env);
  },
} satisfies ExportedHandler<Env>;
