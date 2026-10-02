/**
 * Clamp a login callback target to an internal path (open-redirect guard).
 * Resolves the value exactly the way a browser would and requires the result
 * to stay on-origin: prefix checks alone can be bypassed through URL
 * normalization (`/\evil.example`, tab and newline stripping).
 */
export function safeCallbackUrl(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/repos";
  try {
    const resolved = new URL(raw, "http://internal.invalid");
    if (resolved.origin !== "http://internal.invalid") return "/repos";
    return resolved.pathname + resolved.search;
  } catch {
    return "/repos";
  }
}

/** Recover only a device approval target created by CLI login. */
export function safeDeviceCallback(raw: string | undefined): string | null {
  const callbackUrl = safeCallbackUrl(raw);
  const target = new URL(callbackUrl, "http://internal.invalid");
  const code = target.searchParams.get("code");
  const switchMarker = target.searchParams.get("switch");
  const queryKeys = [...target.searchParams.keys()];
  if (
    target.pathname !== "/login/device" ||
    !code ||
    !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code) ||
    (switchMarker === null ? queryKeys.length !== 1 : switchMarker !== "1" || queryKeys.length !== 2)
  ) {
    return null;
  }
  return `/login/device?code=${encodeURIComponent(code)}${switchMarker === "1" ? "&switch=1" : ""}`;
}
