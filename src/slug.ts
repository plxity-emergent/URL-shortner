// ABOUTME: Derives the slug for a link from a hash of its canonical record.
// ABOUTME: Deterministic so minting is idempotent without a read-before-write against KV.

/** 9 bytes is 72 bits, which base64-encodes to exactly 12 characters with no padding. */
const SLUG_BYTES = 9;

export async function deriveSlug(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(digest).subarray(0, SLUG_BYTES);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
}
