// ABOUTME: Renders the Open Graph document crawlers receive in place of a redirect.
// ABOUTME: Also redirects any human who lands here, so a misclassified visitor still arrives.

export interface LinkRecord {
  readonly namespace: string;
  readonly destination: string;
  readonly title: string;
  readonly description: string;
  readonly image: string | null;
  readonly caller: string;
}

/** Attribute-safe escaping. Every value here comes from the caller, so none of it is trusted. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPreviewHtml(record: LinkRecord): string {
  const title = escapeHtml(record.title);
  const description = escapeHtml(record.description);
  const destination = escapeHtml(record.destination);

  // No image means no image tags at all. A summary_large_image card pointing at nothing renders as
  // a broken thumbnail, which looks worse than the plain card.
  const image = record.image ? escapeHtml(record.image) : null;
  const imageTags = image
    ? `\n<meta property="og:image" content="${image}">\n<meta name="twitter:image" content="${image}">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${destination}">
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">${imageTags}
<meta http-equiv="refresh" content="0; url=${destination}">
</head>
<body><a href="${destination}">${title}</a></body>
</html>`;
}
