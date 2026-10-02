import { fetchUserGroups } from "@/lib/idp-refresh";

export type GroupDenial = {
  /** Why sign-in stopped, for the server log. */
  reason: string;
  /** The IdP couldn't be asked for groups, so the user may succeed on a retry. */
  idpUnavailable: boolean;
};

/**
 * Check the `SCOUTUI_REQUIRED_GROUP` gate during browser sign-in. Returns null
 * when sign-in may continue.
 *
 * A configured group must be confirmed before sign-in. Missing access tokens
 * and userinfo errors deny this attempt; the user can retry when the IdP is
 * available. Existing sessions are not checked here.
 */
export async function idpGroupDenial(
  accessToken: string | undefined,
  requiredGroup: string | null | undefined,
  fetchGroups: (accessToken: string) => Promise<string[]> = fetchUserGroups,
): Promise<GroupDenial | null> {
  const required = (requiredGroup ?? "").trim();
  if (required === "") return null;
  if (!accessToken) {
    return {
      reason: `the identity provider sent no access token, so membership of SCOUTUI_REQUIRED_GROUP (${required}) couldn't be checked`,
      idpUnavailable: false,
    };
  }
  let groups: string[];
  try {
    groups = await fetchGroups(accessToken);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      reason: `couldn't read groups from the identity provider (${reason}), so membership of SCOUTUI_REQUIRED_GROUP (${required}) couldn't be checked`,
      idpUnavailable: true,
    };
  }
  if (groups.includes(required)) return null;
  return { reason: `the account isn't in SCOUTUI_REQUIRED_GROUP (${required})`, idpUnavailable: false };
}
