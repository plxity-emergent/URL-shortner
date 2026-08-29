# URL Shortener

A URL shortener running on Cloudflare Workers with Workers KV. Short links resolve at the edge, and
the same link returns a redirect, an Open Graph card, or JSON depending on who asks for it.

## How it works

### Minting

```
POST /api/links  { url, title?, description? }
      │
      ├─ authenticate against MINT_TOKEN
      ├─ validate url against the host allowlist        → 422 if it fails
      ├─ build the record { destination, title, description }
      ├─ slug = base64url(SHA-256(record)[0..9])        → 12 characters
      ├─ read that slug
      │     free              → write the record
      │     holds this record → return it, no write
      │     holds another     → derive the next candidate, look again (up to 4)
      └─ { short_url }
```

The slug is derived from the record rather than allocated, so the same record always produces the
same slug. Minting is therefore idempotent: repeating a request returns the existing link and writes
nothing.

### Resolving

```
GET /{slug}
      │
      ├─ read the record from KV                        → 404 if absent
      │
      ├─ ?format=json          → 200 application/json, the record
      ├─ crawler user-agent    → 200 text/html, Open Graph tags
      └─ anything else         → 302 to the destination
```

Crawlers get HTML because Slack, X, WhatsApp and LinkedIn fetch a link when it is pasted, do not run
JavaScript, and will not follow a redirect into a page they intend to render. An unrecognised user
agent is treated as human.

JSON is selected by query parameter rather than by the `Accept` header, because a query parameter is
its own cache key. A consumer that renders the destination itself should resolve once and then use
the real URL, rather than pointing a media element at the short link: a `302` is not cacheable, so
each `Range` request would re-walk the redirect.

## API

### `POST /api/links`

Requires `Authorization: Bearer <MINT_TOKEN>`.

| Field | Required | Notes |
| --- | --- | --- |
| `url` | yes | Must pass the host allowlist |
| `title` | no | Stored as null when absent or blank. Clamped to 120 characters |
| `description` | no | Stored as null when absent or blank. Clamped to 200 characters |

`destination` is derived from the validated `url`. Supplying it as a field has no effect.

```bash
curl -X POST "$HOST/api/links" \
  -H "authorization: Bearer $MINT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"https://customer-assets.emergentagent.com/a/b.mp4","title":"Quarterly report"}'
# {"short_url":"https://<host>/kJ3xQz9mB7aY"}
```

| Status | Body | Cause |
| --- | --- | --- |
| 200 | `{ short_url }` | |
| 400 | `invalid_json` | Body was not JSON, or `url` missing |
| 401 | `unauthorized` | Token absent or wrong |
| 405 | `method_not_allowed` | Not a POST |
| 422 | `destination_rejected` | Url failed the allowlist |
| 500 | `slug_exhausted` | Four consecutive slug collisions |

### `GET /{slug}`

| Status | Content | When |
| --- | --- | --- |
| 200 | `application/json` | `?format=json` |
| 200 | `text/html` | Known crawler user-agent |
| 302 | `Location: <destination>` | Everyone else |
| 404 | | Unknown or malformed slug |

```bash
curl -sI "$HOST/kJ3xQz9mB7aY"                              # 302
curl -s  "$HOST/kJ3xQz9mB7aY?format=json"                  # { slug, destination, title, description }
curl -s -A "Slackbot-LinkExpanding 1.0" "$HOST/kJ3xQz9mB7aY"   # Open Graph document
```

The JSON response carries `access-control-allow-origin: *` and `cache-control: public, max-age=1800`.

### `GET /health`

Returns `200 ok`.

## Project structure

```
src/
  index.ts       fetch handler: routing, auth, mint, resolve
  allowlist.ts   the only module that names a hostname
  slug.ts        deriveSlug
  crawler.ts     isCrawler
  og.ts          LinkRecord and the Open Graph document
test/            one suite per module, plus an end-to-end suite
```

## Configuration

| Where | What |
| --- | --- |
| `src/allowlist.ts` | Allowed destination hosts. Matched label by label, not by prefix or suffix |
| `src/slug.ts` | `SLUG_BYTES`, currently 9, giving 12-character slugs. Keep it a multiple of 3 |
| `src/index.ts` | `CACHE_SECONDS` (1800), `MAX_PROBES` (4), and the title and description length caps |
| `wrangler.jsonc` | Cloudflare account id, KV binding, `workers_dev` |
| Worker secret | `MINT_TOKEN` |

## Local development

```bash
npm install
echo 'MINT_TOKEN=local-development-token' > .dev.vars
npm test          # 46 tests, run in workerd
npm run typecheck
npm run dev       # http://localhost:8787
```

Tests and `npm run dev` run entirely on Miniflare and do not contact a Cloudflare account.

## Deployment

`npm run deploy`, or push to `main` and let `.github/workflows/deploy.yml` do it. The workflow needs
two repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Target account id |
| `CLOUDFLARE_API_TOKEN` | Token with **Workers Scripts: Edit** and **Workers KV Storage: Edit** |

The account id is also pinned in `wrangler.jsonc`, so Wrangler cannot select a different account
when the credentials can see more than one.
