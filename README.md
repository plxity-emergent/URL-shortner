# URL shortener

Short links resolved at the edge on Cloudflare Workers. One URL answers three different audiences
with three different responses, and the list of hosts it will redirect to lives in one file.

Slugs are 12 URL-safe characters, computed from the record rather than handed out by a counter.

## Status

| | |
| --- | --- |
| Worker | `url-shortener`, **Dev** account, at `https://url-shortener.manish-f0f.workers.dev` |
| KV | `LINKS`, **Dev** account |
| Domain | none. Only the `*.workers.dev` hostname Cloudflare provides |
| CI | tests on every push and PR, deploys `main` |
| Audience | internal services only. The mint endpoint is token-guarded and was never public |

The Dev account id is pinned in `wrangler.jsonc`. Leave it there: the credentials in use can see a
Prod account too, and without it Wrangler is free to choose.

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

`title` and `description` are optional and **nothing is substituted when they are absent**. A
blank or missing value is stored as null and the crawler card simply omits those tags. A crawler
that finds no `og:title` shows the url as the headline, which is the honest outcome: the link has no
name. Inventing one would put words in the caller's mouth on a page carrying their branding.

`destination` is derived from the validated `url` and cannot be set directly, so neither the
allowlist nor the stored record can be talked around by sending extra fields.

Use the full destination path. The Worker validates the **host**, not whether the file exists, so a
truncated path mints a link the origin will reject.

### Example

```bash
export MINT_TOKEN=…   # the Worker secret; ask, or read it from your own .dev.vars

H=https://url-shortener.manish-f0f.workers.dev

curl -X POST $H/api/links \
  -H "authorization: Bearer $MINT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"https://customer-assets.emergentagent.com/a/b.mp4","title":"Quarterly report"}'
# {"short_url":"https://url-shortener.manish-f0f.workers.dev/kJ3xQz9mB7aY"}

curl -sI $H/kJ3xQz9mB7aY                                   # 302 to the destination
curl -s  "$H/kJ3xQz9mB7aY?format=json"                     # the record
curl -s -A "Slackbot-LinkExpanding 1.0" $H/kJ3xQz9mB7aY    # the card
```

Run the POST twice and you get the same link back. Minting is idempotent.

## Three responses, one url

| Who asks | What they get | Why |
| --- | --- | --- |
| `?format=json` | the record as JSON | so a consumer can resolve once and use the destination directly |
| A known crawler | an Open Graph document | Slack and friends fetch on paste, do not run JS, and will not follow a redirect |
| Anyone else | `302` to the destination | the normal case |

**The crawler branch** is the only reason a paste unfurls as a card. Its one real decision is which
way to be wrong: anything unrecognised counts as human, because a crawler misread as human costs a
preview card, while a human misread as a crawler gets HTML instead of the thing they clicked. The
pattern names crawlers explicitly and never matches a generic `bot`, and the card carries a
`meta refresh` as a second net.

**Do not point a `<video>` or `<img>` at a short url.** A media element issues many `Range`
requests, a `302` is not cacheable, so the browser re-walks the redirect on every chunk and pays the
extra hop each time. Measured: ~190ms via the shortener against ~30ms straight to the origin.
Resolving once with `?format=json` instead moves the whole transfer to the origin: **332 bytes**
from here against **5.6 MB** direct.

JSON is selected by query parameter rather than by `Accept`, deliberately. A query parameter is its
own cache key, so one url can never serve a cached JSON body to someone who wanted the redirect.
Content negotiation on `Accept` would work too, but only with a `Vary: Accept` header, and that is
one more thing to get right for no benefit here.

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

### The probe

A slug can be in one of three states, and minting handles all three:

| State at the slug | What happens |
| --- | --- |
| **Free** (nothing stored) | write the record, return the slug |
| **Taken by an identical record** | return the slug. No retry, and no write |
| **Taken by a different record** | probe: derive the next candidate and look again |

```ts
if (existing && !isSameRecord(existing, record)) continue;
if (!existing) await env.LINKS.put(slug, JSON.stringify(record));
return slug;
```

"Identical" means the three record fields match, not that the same person minted it. There is no
author or caller anywhere in the record. Two people minting the same destination with the same title
get the same link, which is what stops one thing accumulating duplicate links.

The probe sequence is derived from the record, so a re-mint retraces the same steps and lands on the
same slug. That is what keeps minting idempotent without a reverse index. It also means an unchanged
re-mint costs one read and no write, cheaper than the blind `put` it replaced, since a read is a
tenth the price of a write. Four exhausted probes returns `slug_exhausted` rather than overwriting
anyone.

### What the probe does not fix

Two honest limits, both properties of KV rather than bugs:

- **KV caches reads for at least 60 seconds.** If two *different* records hash to the same slug and
  are minted inside that window, both can read the slot as free and both write, and the second
  destroys the first. The probe catches collisions against settled links, which is nearly all of
  them in practice, not this concurrent case. Note this only concerns records that differ: two mints
  of the *same* record write identical bytes, so a double write there loses nothing.
- **KV has no put-if-absent.** Read-then-write is not atomic, so even with a perfectly fresh read
  two requests can both find the slot empty. That cannot be closed here at all; it needs a store
  with real atomicity, such as a unique constraint or a Durable Object.

So the keyspace is still doing most of the work. 2^72 puts a collision at roughly one in a million
at 100 million links. If that ever feels tight, widen `SLUG_BYTES` from 9 to 12 for 16-character
slugs and roughly one in four billion. Do not go below 10.

### A gap worth knowing

The slug depends on the record, and the record depends on this code. Changing the record's shape
re-keys every future mint. Old links keep resolving, but a caller re-minting an old input after such
a change quietly gets a second link for the same thing. Fix, if it matters: version the canonical
string, or hash only caller-supplied fields.

## Caching

`CACHE_SECONDS` is 1800 and applies in two independent places: the KV edge read, and `max-age` on
the JSON response. Worst case a changed or revoked link keeps serving the old answer for about an
hour. Nothing else is cached: the redirect and the crawler card are computed fresh every request.

## FAQ

**What if two people request the same destination URL?**
Depends on the rest of the request. Same url, title and description gives one link, and asking again
returns that same link without writing. Different card text gives two slugs that both resolve to the
same file. The whole record is the identity, not just the url. That is deliberate: it means nobody
can silently retitle someone else's link, and the price is that one file can end up with several.

**What if two different records land on the same slug?**
Minting reads the slot first. If it holds a different record it derives the next candidate and tries
again, up to four times, and never overwrites. Four exhausted probes returns `500 slug_exhausted`.
The one gap it cannot close: KV caches reads for 60 seconds and has no put-if-absent, so two
colliding records minted inside that window can both see a free slot. Roughly 10^-20 per mint.

**What stops this becoming an open redirect?**
The allowlist, plus the fact that `destination` is derived from the validated `url` rather than
accepted as a field. Hosts are matched label by label, because `endsWith` would accept
`…emergentagent.com.evil.test` and `startsWith` would accept `customer-assetshub…`, both tested.
`preview` subdomains are excluded because they serve user-controlled content. A leaked mint token
can only produce links to allowlisted hosts.

**Can someone change or delete a link?**
Neither, and those are one property seen from two sides. A different record is a different slug, so
there is no way to address an existing link and rewrite it, and there is no delete path either, so
nothing can be cleaned up. Note that an unguessable slug is obscurity, not access control: anyone
holding a link can follow it, so anything sensitive must be protected at the destination.

## Local development

```bash
npm install
echo 'MINT_TOKEN=local-development-token' > .dev.vars
npm test          # 46 tests, runs in workerd, no network
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
Deploys have been by hand in the meantime.

## Integrating

Do not expose the mint endpoint to browsers. An endpoint a browser can reach is one anybody's
browser can reach, and the allowlist constrains where a link points, not the title wrapped around
it, so an open mint lets a stranger publish a link on your domain saying whatever they like. KV
writes are billed too, which makes it a denial-of-wallet target.

Put an authenticated endpoint in a service you already run, have it hold the token, and let it
forward. Then:

- **Mint when someone asks to share**, not when the thing is created. Most items are never shared.
- **Fire it when the share UI opens**, not on the copy button. Clipboard APIs want a user gesture,
  and awaiting a fetch inside the click handler loses it in Safari.
- **Keep the long url and fall back to it.** Shortening is cosmetic; nothing about sharing should
  break when the service is down.

## Not implemented

- **Revocation and expiry.** KV holds the only copy and nothing deletes it. A handful of throwaway
  records from testing sit there permanently.
- **Preview images.** Cards are text-only; there is no validated source for a thumbnail.
- **Click analytics.** When wanted, put it behind `ctx.waitUntil` so it never delays the redirect.
- **Custom slugs.** Every slug is derived. Vanity slugs need their own keyspace, a reserved-word
  list, and the compare-and-set KV cannot do.
