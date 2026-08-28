// ABOUTME: Decides whether a candidate url is one this service is willing to wrap.
// ABOUTME: The rejection path is the security boundary: a permissive rule here is an open redirect.

import type { HostRule, LabeledHostRule, Namespace } from "./namespaces";

function matchesLabeled(hostname: string, rule: LabeledHostRule): boolean {
  const labels = hostname.toLowerCase().split(".");
  if (labels.length < 3 || labels.length > 4) return false;
  if (!rule.apexes.includes(labels.slice(-2).join("."))) return false;

  // The leftmost label is the family's own, either bare or with a per-deployment suffix.
  const head = labels[0];
  if (head !== rule.label && !head.startsWith(`${rule.label}-`)) return false;

  // Nothing between the label and the apex, or exactly one listed environment label.
  const environment = labels.slice(1, -2);
  if (environment.length === 0) return true;
  return environment.length === 1 && rule.envLabels.includes(environment[0]);
}

export function matchesAnyRule(url: URL, rules: readonly HostRule[]): boolean {
  if (url.protocol !== "https:") return false;
  return rules.some(rule =>
    rule.kind === "origin" ? url.origin === rule.origin : matchesLabeled(url.hostname, rule),
  );
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function validateDestination(raw: string, namespace: Namespace): string | null {
  const url = parse(raw);
  if (!url) return null;
  if (!matchesAnyRule(url, namespace.destination)) return null;
  if (namespace.path !== undefined && url.pathname !== namespace.path) return null;

  if (namespace.inner) {
    const inner = url.searchParams.get(namespace.inner.param);
    const innerUrl = inner ? parse(inner) : null;
    if (!innerUrl || !matchesAnyRule(innerUrl, namespace.inner.rules)) return null;
  }

  return url.toString();
}

export function validateImage(raw: string, namespace: Namespace): string | null {
  if (!namespace.image) return null;
  const url = parse(raw);
  return url && matchesAnyRule(url, namespace.image) ? url.toString() : null;
}
