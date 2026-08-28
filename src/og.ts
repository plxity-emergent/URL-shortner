// ABOUTME: Renders the Open Graph document crawlers receive in place of a redirect.
// ABOUTME: Also redirects any human who lands here, so a misclassified visitor still arrives.

export interface LinkRecord {
  readonly namespace: string;
  readonly destination: string;
  readonly title: string;
  readonly description: string;
  readonly image: string;
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
  const image = escapeHtml(record.image);
  const destination = escapeHtml(record.destination);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${destination}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${destination}">
</head>
<body><a href="${destination}">${title}</a></body>
</html>`;
}
