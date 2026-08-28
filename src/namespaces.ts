// ABOUTME: The registry of link kinds: what each may point at, who may mint it, how its card reads.
// ABOUTME: The only module that names hosts. Supporting a new kind of link is an entry here, not code.

/** An exact origin. Use this whenever the set of destinations is a known, fixed list. */
export interface OriginHostRule {
  readonly kind: "origin";
  readonly origin: string;
}

/**
 * A host family: a fixed leftmost label (optionally suffixed), an optional single environment
 * label, then one of a set of apexes. Matched label by label, never by prefix or suffix.
 */
export interface LabeledHostRule {
  readonly kind: "labeled";
  readonly label: string;
  readonly apexes: readonly string[];
  readonly envLabels: readonly string[];
}

export type HostRule = OriginHostRule | LabeledHostRule;

export interface Namespace {
  /** Rules the destination URL itself must satisfy. At least one is required. */
  readonly destination: readonly HostRule[];
  /** When set, the destination's path must match exactly. */
  readonly path?: string;
  /**
   * For wrapper destinations carrying the real target in a query parameter: the parameter name and
   * the rules that target must satisfy. Both the wrapper and the target are then validated.
   */
  readonly inner?: { readonly param: string; readonly rules: readonly HostRule[] };
  /** Rules a caller-supplied preview image must satisfy. An image failing these is dropped. */
  readonly image?: readonly HostRule[];
  /** Named mint tokens permitted to create links in this namespace. */
  readonly callers: readonly string[];
  readonly defaultTitle: string;
  readonly defaultDescription: string;
}

/**
 * PLACEHOLDER. `example` exists so the service is functional and the tests are real. Replace it
 * with entries whose destination hosts someone has actually confirmed. Never guess a hostname in
 * here: an over-broad rule is the difference between a shortener and an open redirect.
 */
export const NAMESPACES: Record<string, Namespace> = {
  example: {
    destination: [{ kind: "origin", origin: "https://example.com" }],
    callers: ["proxy"],
    defaultTitle: "Shared link",
    defaultDescription: "Opens in your browser",
  },
};

export function getNamespace(id: string): Namespace | null {
  return Object.hasOwn(NAMESPACES, id) ? NAMESPACES[id] : null;
}
