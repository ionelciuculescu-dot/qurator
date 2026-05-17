/** `generic:204481919` → `generic--204481919` (fără `:` în path — evită 404 la proxy / rutare). */
export function externalIdToPathSegment(externalId: string): string {
  return externalId.trim().replace(/:/g, "--");
}

/** Variante de căutare în DB pentru segmentul din URL (slug nou, vechi %3A, id numeric). */
export function pathSegmentToLookupKeys(segment: string): string[] {
  const keys = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (t) keys.add(t);
  };

  add(segment);
  try {
    add(decodeURIComponent(segment));
  } catch {
    /* segment deja decodat */
  }

  for (const s of [...keys]) {
    if (s.includes("--")) add(s.replace(/--/g, ":"));
    if (/%3a/i.test(s)) add(s.replace(/%3A/gi, ":"));

    const providerNumeric = /^([a-z0-9_]+)-(\d+)$/i.exec(s);
    if (providerNumeric) add(`${providerNumeric[1]}:${providerNumeric[2]}`);
  }

  return [...keys];
}
