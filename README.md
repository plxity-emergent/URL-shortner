# URL shortener

Short links resolved at the edge on Cloudflare Workers. Crawlers get a proper Open Graph preview
card instead of a bare URL, and the list of hosts it is willing to redirect to lives in one file.

Slugs are 12 URL-safe characters, computed from the record rather than handed out by a counter.

## Status

Deployed to the **Dev** Cloudflare account only. No custom domain, so the only hostname is the
`*.workers.dev` one Cloudflare provides.

## API

```
POST /api/links
  Authorization: Bearer <mint token>
  { "url": "https://…", "title": "…", "description": "…" }

  200  { "short_url": "https://<host>/kJ3xQz9mB7aY" }
  400  invalid_json           body was not JSON, or url missing
  401  unauthorized           token absent or wrong
  405  method_not_allowed     not a POST
  422  destination_rejected   url is not on the allowlist
  500  slug_exhausted         four consecutive slug collisions; effectively impossible

GET /{slug}
  200  application/json       when asked with ?format=json
  200  text/html              Open Graph document, for known crawlers
  302  Location: <destination>  for everyone else
  404  unknown or malformed slug

GET /health
  200  ok
```

`title` and `description` are optional and fall back to the defaults in `src/allowlist.ts`.

`destination` is derived from the validated `url` and cannot be set directly, so neither the
allowlist nor the stored record can be talked around by sending extra fields.

### Example

```bash
export MINT_TOKEN=…

curl -X POST https://<host>/api/links \
  -H "authorization: Bearer $MINT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"https://customer-assets.emergentagent.com/a/b.mp4","title":"Diet Coke, final cut"}'
# {"short_url":"https://<host>/kJ3xQz9mB7aY"}

curl -sI https://<host>/kJ3xQz9mB7aY                    # 302 to the destination
curl -s  "https://<host>/kJ3xQz9mB7aY?format=json"      # the record
curl -s -A "Slackbot-LinkExpanding 1.0" https://<host>/kJ3xQz9mB7aY   # the card
```

## Three responses, one url

| Who asks | What they get | Why |
| --- | --- | --- |
| `?format=json` | the record as JSON | so a consumer can resolve once and use the destination directly |
| A known crawler | an Open Graph document | Slack and friends fetch on paste, do not run JS, and will not follow a redirect |
| Anyone else | `302` to the destination | the normal case |

JSON is selected by query parameter rather than by `Accept`, deliberately. A query parameter is its
own cache key, so one url can never serve a cached JSON body to someone who wanted the redirect.
Content negotiation on `Accept` would work too, but only with a `Vary: Accept` header, and it is one
more thing to get right for no benefit here.

**Do not point a `<video>` or `<img>` at a short url.** A media element issues many `Range`
requests, a `302` is not cacheable, so the browser re-walks the redirect on every chunk and pays the
extra hop each time. Resolve once with `?format=json`, then use the real url.

## The allowlist

`src/allowlist.ts` is the only module that names a hostname. Matching is done label by label,
because `endsWith` would accept `customer-assets.emergentagent.com.evil.test` and `startsWith` would
accept `customer-assetshub.emergentagent.com`. Both are tested and both must keep failing.

`preview` is deliberately absent from the allowed environment labels: those subdomains serve
user-controlled content.

A permissive rule here is an open redirect, and an open redirect gets the domain flagged, which
breaks every link the service has ever handed out.

## Slugs and collisions

`deriveSlug` takes SHA-256 of the record, keeps the first 9 bytes, and base64url-encodes them. Nine
bytes because it is a multiple of three, so the output is exactly 12 characters with no padding.

Minting the same record twice returns the same slug, so callers can retry freely and re-minting on
every share leaves no duplicates.

On a collision, minting probes. It derives the next candidate slug from the record and tries again,
up to four times, and only writes into a slot that is free or already its own. The probe sequence is
derived from the record, so a re-mint retraces the same steps and lands on the same slug, which is
what keeps minting idempotent without a reverse index. It also means an unchanged re-mint costs one
read and no write, cheaper than the blind put it replaced. If all four probes are taken, minting
fails with `slug_exhausted` rather than overwriting anyone.

Two caveats, both honest limits rather than bugs. KV caches reads for at least 60 seconds, so two
mints colliding inside that window can both see a free slot and both write; the probe catches
collisions against settled links, which is nearly all of them, not the concurrent case. And KV has
no put-if-absent, so read-then-write is not atomic and that case cannot be closed here at all.

The keyspace is still doing most of the work: 2^72, so a collision is around one in a million at
100 million links. If that ever feels tight, widen `SLUG_BYTES` from 9 to 12 for 16-character slugs
and roughly one in four billion. Do not go below 10.

**The slug depends on the record, so changing the record's shape re-keys every future mint.** Old
links keep resolving, but a caller re-minting after such a change quietly gets a second link for the
same thing.

## Caching

`CACHE_SECONDS` is 1800 and applies in two independent places: the KV edge read, and `max-age` on
the JSON response. Worst case a changed or revoked link keeps serving the old answer for about an
hour. Nothing else is cached: the redirect and the crawler card are computed fresh every request.

## Local development

```bash
npm install
echo 'MINT_TOKEN=local-development-token' > .dev.vars
npm test          # 43 tests, runs in workerd, no network
npm run typecheck
npm run dev       # http://localhost:8787
```

None of that contacts a Cloudflare account.

## Deployment

Pushing to `main` runs the tests and deploys. Two repository secrets are required:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | the Dev account id |
| `CLOUDFLARE_API_TOKEN` | a Dev-scoped token with **Workers Scripts: Edit** and **Workers KV Storage: Edit** |

`CLOUDFLARE_API_TOKEN` is currently a placeholder, so the deploy job fails until a real one is set.

The account id is also pinned in `wrangler.jsonc`. Leave it there: the credentials in use can see a
Prod account too, and without it Wrangler is free to choose.

## Integrating

Do not expose the mint endpoint to browsers. Put an authenticated endpoint in a service you already
run, have it hold the token, and let it forward. Then:

- **Mint when someone asks to share**, not when the thing is created. Most items are never shared.
- **Fire it when the share UI opens**, not on the copy button. Clipboard APIs want a user gesture,
  and awaiting a fetch inside the click handler loses it in Safari.
- **Keep the long url and fall back to it.** Shortening is cosmetic; nothing about sharing should
  break when the service is down.

## Not implemented

- Revocation and expiry. KV holds the only copy and nothing deletes it.
- Preview images. Cards are text-only. There is no validated source for a thumbnail yet.
- Click analytics. When wanted, put it behind `ctx.waitUntil` so it never delays the redirect.
- Custom slugs. Every slug is derived; vanity slugs need their own keyspace and a compare-and-set
  KV cannot do.
