// ABOUTME: The one place a hostname is named, and the only thing standing between this service
// ABOUTME: and being an open redirect. Everything here is a rejection rule.

const LABEL = "customer-assets";
const APEXES = ["emergentagent.com", "emergentagent.net"];
/** Environment segment allowed between the label and the apex. `preview` is deliberately absent:
 *  those subdomains serve user-controlled content and must never be wrappable. */
const ENV_LABELS = ["staging", "dev"];

export const DEFAULT_TITLE = "Shared link";
export const DEFAULT_DESCRIPTION = "Opens in your browser";

/**
 * Matched label by label. `endsWith` would accept `customer-assets.emergentagent.com.evil.test`
 * and `startsWith` would accept `customer-assetshub.emergentagent.com`. Both are tested.
 */
function isAllowedHost(hostname: string): boolean {
  const labels = hostname.toLowerCase().split(".");
  if (labels.length < 3 || labels.length > 4) return false;
  if (!APEXES.includes(labels.slice(-2).join("."))) return false;

  const head = labels[0];
  if (head !== LABEL && !head.startsWith(`${LABEL}-`)) return false;

  const environment = labels.slice(1, -2);
  return environment.length === 0 || (environment.length === 1 && ENV_LABELS.includes(environment[0]));
}

/** The normalized url, or null when it is not one we will wrap. */
export function validateDestination(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && isAllowedHost(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}
