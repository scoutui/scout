export class IdpRefreshError extends Error {
  constructor(public reason: "network" | "config", message: string) {
    super(message);
    this.name = "IdpRefreshError";
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new IdpRefreshError("config", `${name} is required`);
  return v;
}

/**
 * The issuer's discovery document: the one `.well-known` fetch, with one failure
 * shape, that every identity provider lookup starts from.
 *
 * The trailing slash is stripped from the configured URL because this builds a
 * URL. Don't reuse that to compare an `iss` claim: providers advertise their
 * issuer with or without the slash and put that exact string in their tokens,
 * so a claim check reads `issuer` from this document (`discoverIssuerMetadata`).
 */
async function discoveryDocument(): Promise<Record<string, unknown>> {
  const configured = env("OIDC_ISSUER_URL").replace(/\/$/, "");
  try {
    const r = await fetch(`${configured}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`discovery ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  } catch (e) {
    throw new IdpRefreshError("network", `OIDC discovery failed: ${String(e)}`);
  }
}

async function discoverUserinfoEndpoint(): Promise<string> {
  // biome-ignore lint/complexity/useLiteralKeys: index signature on the parsed document
  const endpoint = (await discoveryDocument())["userinfo_endpoint"];
  if (!endpoint) throw new IdpRefreshError("network", "OIDC discovery failed: no userinfo_endpoint");
  return endpoint as string;
}

/**
 * What it takes to verify a signature the issuer produced: where its keys are,
 * and the exact issuer string its tokens carry.
 *
 * Both come from the discovery document, not `OIDC_ISSUER_URL`, because OIDC
 * Discovery §4.3 makes the advertised `issuer` the authority on what appears in
 * an `iss` claim. Authentik advertises a trailing slash and signs it into every
 * token, whether or not the operator typed it in the configuration.
 */
export async function discoverIssuerMetadata(): Promise<{ issuer: string; jwksUri: string }> {
  const disc = await discoveryDocument();
  // biome-ignore lint/complexity/useLiteralKeys: index signature on the parsed document
  const issuer = disc["issuer"];
  // biome-ignore lint/complexity/useLiteralKeys: index signature on the parsed document
  const jwksUri = disc["jwks_uri"];
  if (typeof issuer !== "string" || typeof jwksUri !== "string") {
    throw new IdpRefreshError("network", "OIDC discovery failed: no issuer or jwks_uri");
  }
  return { issuer, jwksUri };
}

export async function fetchUserGroups(accessToken: string): Promise<string[]> {
  const userinfoEndpoint = await discoverUserinfoEndpoint();
  const res = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new IdpRefreshError("network", `userinfo ${res.status}`);
  const body = (await res.json()) as { groups?: unknown };
  const rawGroups = body.groups;
  return Array.isArray(rawGroups) ? rawGroups.filter((g) => typeof g === "string") : [];
}
