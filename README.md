# URL shortener

Short links any service can create, resolved at the edge on Cloudflare Workers. Crawlers get a
proper Open Graph preview card instead of a bare URL, and the list of things the service is willing
to redirect to lives in a registry file rather than smeared through the request handler.

Slugs are 12 URL-safe characters, computed from the record rather than handed out by a counter.

## Status

Deployed to the **Dev** Cloudflare account only. No custom domain is attached, so the only hostname
is the `*.workers.dev` one Cloudflare provides. The registry currently holds a single placeholder
namespace and needs replacing with real entries before this is useful to anything.

## API

```
POST /api/links
  Authorization: Bearer <mint token>
  { "namespace": "example", "url": "https://…", "title": "…", "description": "…", "image": "https://…" }

  200  { "short_url": "https://<host>/kJ3xQz9mB7aY" }
  400  invalid_json           body was not JSON, or url/namespace missing
  401  unauthorized           token absent or unrecognized
  403  caller_not_permitted   valid token, wrong namespace for this caller
  405  method_not_allowed     not a POST
  422  unknown_namespace      namespace is not in the registry
  422  destination_rejected   url failed the namespace's rules

GET /{slug}
  200  text/html              Open Graph document, for known crawlers
  302  Location: <destination>  for everyone else
  404  unknown or malformed slug

GET /health
  200  ok
```

`title` and `description` are optional and fall back to whatever the namespace declares.

`image` is optional too, but it is only kept if the namespace declares `image` rules and the URL
satisfies them. Anything else is dropped, and a link with no image renders no `og:image` at all and
falls back to a plain `summary` card rather than a `summary_large_image` one pointing at nothing.
Dropping is deliberate: a bad thumbnail should cost you a thumbnail, not a link, and an unvalidated
attacker-supplied `og:image` on your own domain is worth refusing.

## Adding a namespace

A namespace is a registered kind of link. It says what it may point at, who is allowed to create
one, and how its preview card reads. Everything lives in `src/namespaces.ts`, which is the only
module in the codebase allowed to name a hostname.

```ts
docs: {
  destination: [{ kind: "origin", origin: "https://docs.example.com" }],
  callers: ["proxy"],
  defaultTitle: "Documentation",
  defaultDescription: "Opens in your browser",
},
```

Two rule shapes are available:

- `origin` matches an exact origin. Use it whenever the set of destinations is a known, fixed list.
- `labeled` matches a host family: a fixed leftmost label (optionally suffixed), an optional single
  environment label, then one of a set of apexes. Matching is done label by label, because
  `endsWith` would accept `assets.example.com.evil.test` and `startsWith` would accept
  `assetshub.example.com`. There are tests for both.

Set `path` when the namespace only wraps one route. Set `inner` when the destination is a wrapper
that carries the real target in a query parameter, and both will be validated.

**Never guess a hostname into this file.** An over-broad rule here is the difference between a
shortener and an open redirect, and an open redirect gets the domain flagged, which breaks every
link the service has ever handed out.

Add a test alongside every entry covering what it should accept and what it must refuse.

## Slugs and collisions

`deriveSlug` takes SHA-256 of the canonical record, keeps the first 9 bytes, and base64url-encodes
them. Nine bytes because it is a multiple of three, so the output is exactly 12 characters with no
padding to strip.

Minting the same record twice gives the same slug back, which is the point: callers can retry
without thinking, and re-minting on every share leaves no duplicates behind.

Two genuinely different records landing on the same slug is unguarded. There is no uniqueness check
anywhere here. Minting is a single `KV.put` that does not read first, does not compare, and would
not notice. The keyspace is 2^72, so a collision is around one in a million at 100 million links,
and that is the whole defense. It is a bet, written down deliberately.

Retrying on a collision would work, and it would stay idempotent, because a record can walk the same
probe sequence every time. It is left out because on KV the check cannot be trusted: writes take up
to a minute to propagate and misses are cached for up to a minute, so the collision most worth
catching is exactly the one that reads back as free. There is also no compare-and-set, so racing
mints clobber each other regardless. If the odds ever feel tight, widen `SLUG_BYTES` from 9 to 12
for 16-character slugs and roughly four thousand times the headroom. Do not go below 10 characters
without adding a real collision path first.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm test          # 43 tests, runs in workerd via @cloudflare/vitest-plugin, no network
npm run typecheck
npm run dev       # http://localhost:8787
```

Everything above runs locally against Miniflare. None of it contacts a Cloudflare account.

## Deployment

Pushing to `main` runs the tests and then deploys, via `.github/workflows/deploy.yml`.

Two repository secrets are required:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The Dev account ID |
| `CLOUDFLARE_API_TOKEN` | An API token scoped to the Dev account with **Workers Scripts: Edit** and **Workers KV Storage: Edit** |

`CLOUDFLARE_API_TOKEN` currently holds a placeholder, so the deploy job will fail until a real token
is set. Create one at **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**, restrict
it to the Dev account, then `gh secret set CLOUDFLARE_API_TOKEN`.

The account ID is also pinned in `wrangler.jsonc`. That is deliberate and worth leaving alone: the
credentials used here can see a Prod account too, and without an explicit `account_id` Wrangler is
free to choose.

## Integrating

Do not expose the mint endpoint to browsers. An endpoint a browser can reach is one anybody's
browser can reach, and the namespace rules constrain where a link points, not the title and image
wrapped around it, so an open mint lets a stranger publish a link on your domain saying whatever
they like. KV writes are billed too, which makes it a denial-of-wallet target.

Put an authenticated endpoint in a service you already run, have it hold the mint token, and let it
forward. Roughly:

```python
async def mint_short_link(namespace, url, title=None, description=None, image=None):
    payload = {"namespace": namespace, "url": url}
    for key, value in (("title", title), ("description", description), ("image", image)):
        if value:
            payload[key] = value

    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(
            f"{SHORTENER_URL}/api/links",
            json=payload,
            headers={"Authorization": f"Bearer {MINT_TOKEN}"},
        )

    if response.status_code == 422:
        raise HTTPException(422, "unshortenable_url")
    if response.status_code >= 400:
        raise HTTPException(502, "shortener_failed")
    return response.json()["short_url"]
```

Three things worth getting right in the caller:

- **Mint when someone asks to share, not when the thing is created.** Most items are never shared.
- **Fire it when the share UI opens, not on the copy button.** Clipboard APIs want a user gesture,
  and awaiting a fetch inside the click handler loses it in Safari.
- **Keep the long URL and fall back to it.** Shortening is cosmetic, so nothing about sharing should
  break when the service is down.

## Not implemented

- Revocation and expiry. KV holds the only copy and nothing deletes it. Note that a killed link
  would keep resolving for up to five minutes at a warm PoP under the current `cacheTtl`.
- Click analytics. When wanted, put it behind `ctx.waitUntil` so it never delays the redirect. The
  record already carries `namespace` and `caller` to group by.
- Custom slugs. Every slug is derived. Vanity slugs need their own keyspace, a reserved-word list,
  and a compare-and-set that KV cannot do.
- Any management API. It mints and it resolves.
