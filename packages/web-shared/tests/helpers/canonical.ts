type Encoded = ["undefined"] | ["null"] | ["string", string] | ["number", number] | ["boolean", boolean] | ["array", Encoded[]] | ["object", Record<string, Encoded>];

function encode(value: unknown): Encoded {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "number" && Number.isFinite(value)) return ["number", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  if (typeof value === "object") {
    return ["object", Object.fromEntries(Object.keys(value).sort().map(key => [key, encode((value as Record<string, unknown>)[key])]))];
  }
  throw new Error(`Unsupported value: ${String(value)}`);
}

export function canonical(value: unknown): string {
  return JSON.stringify(encode(value));
}

export function assertCanonicalEqual(actual: unknown, expected: unknown): void {
  function compare(a: unknown, e: unknown, path: string): void {
    if (canonical(a) === canonical(e)) return;
    if (a !== null && e !== null && typeof a === "object" && typeof e === "object" && Array.isArray(a) === Array.isArray(e)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(e)])].sort()) {
        const next = Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`;
        if (Object.hasOwn(a, key) !== Object.hasOwn(e, key)) throw new Error(`Mismatch at ${next}: missing field`);
        compare((a as Record<string, unknown>)[key], (e as Record<string, unknown>)[key], next);
      }
    }
    throw new Error(`Mismatch at ${path}: expected ${canonical(e).slice(0, 160)}, received ${canonical(a).slice(0, 160)}`);
  }
  compare(actual, expected, "$" );
}
