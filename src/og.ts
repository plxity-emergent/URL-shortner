// ABOUTME: Renders the Open Graph document crawlers receive in place of a redirect.
// ABOUTME: Also redirects any human who lands here, so a misclassified visitor still arrives.

export interface LinkRecord {
  readonly destination: string;
  /** Null when the caller supplied none. Nothing is invented on their behalf. */
  readonly title: string | null;
  readonly description: string | null;
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

/**
 * Absent card text emits no tag at all, rather than a placeholder.
 *
 * A crawler that finds no `og:title` falls back to showing the url as the headline, which is the
 * honest outcome: the link genuinely has no name. Inventing one would put words in the caller's
 * mouth on a page that carries their branding.
 */
function metaTags(record: LinkRecord): string {
  const lines: string[] = [];
  if (record.title !== null) {
    const title = escapeHtml(record.title);
    lines.push(`<title>${title}</title>`, `<meta property="og:title" content="${title}">`);
    lines.push(`<meta name="twitter:title" content="${title}">`);
  }
  if (record.description !== null) {
    const description = escapeHtml(record.description);
    lines.push(`<meta property="og:description" content="${description}">`);
    lines.push(`<meta name="twitter:description" content="${description}">`);
  }
  return lines.join("\n");
}

export function renderPreviewHtml(record: LinkRecord): string {
  const destination = escapeHtml(record.destination);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${metaTags(record)}
<meta property="og:type" content="website">
<meta property="og:url" content="${destination}">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0; url=${destination}">
</head>
<body><a href="${destination}">${escapeHtml(record.title ?? record.destination)}</a></body>
</html>`;
}
