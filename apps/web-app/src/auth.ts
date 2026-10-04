import NextAuth, { type NextAuthResult } from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb, schema } from "@/db/client";
import { emailDomainDenial } from "@/lib/oidc-domain-gate";
import { idpGroupDenial } from "@/lib/oidc-group-gate";
import { ACCESS_CHECK_UNAVAILABLE } from "@/lib/sign-in-errors";
import { buildProviders } from "@/lib/auth-providers";
import { recordSignIn } from "@/lib/people";
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  nextSessionToken,
  sessionStrategy,
} from "@/lib/auth-session";

const providers = buildProviders();

// Annotated to avoid TS2742 on the `auth` callable, whose inferred type refers
// to types in next-auth's internal lib directory that the package root doesn't
// re-export.
const nextAuth: NextAuthResult = NextAuth({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers,
  // `auth-session.ts` explains why the update age sits above the max age.
  session: {
    strategy: sessionStrategy(),
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // Dev bypass: skip the OIDC domain and group gates entirely.
      if (account?.provider === "dev") return true;
      const domainDenial = emailDomainDenial(
        user.email,
        // biome-ignore lint/complexity/useLiteralKeys: env access
        process.env["OIDC_ALLOWED_DOMAINS"],
        profile?.email_verified,
      );
      const groupDenial =
        domainDenial === null
          ? await idpGroupDenial(
              account?.access_token,
              // biome-ignore lint/complexity/useLiteralKeys: env access
              process.env["SCOUTUI_REQUIRED_GROUP"],
            )
          : null;
      const reason = domainDenial ?? groupDenial?.reason;
      if (reason === undefined) return true;
      console.warn(`[auth] sign-in denied for ${user.email ?? "an account with no email address"}: ${reason}`);
      // Both outcomes leave the user signed out. A redirect instead of `false`
      // gives the login page its own error, since Auth.js reports every
      // `false` as AccessDenied.
      return groupDenial?.idpUnavailable ? `/login?error=${ACCESS_CHECK_UNAVAILABLE}` : false;
    },
    async jwt({ token, trigger }) {
      // Returning null makes Auth.js clear the session cookie, so an expired
      // session lands on /login rather than a half-broken authenticated page.
      return nextSessionToken(token, trigger, Date.now());
    },
    async session({ session, token, user }) {
      // The user id reaches this callback from a different place per strategy:
      // the adapter's user row under "database", `token.sub` under "jwt". Map
      // whichever arrived onto session.user so server actions keep reading
      // session.user.id regardless.
      const userId = user?.id ?? token?.sub;
      if (session.user && userId) session.user.id = userId;
      return session;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      if (!user.id || !user.email) return;
      await recordSignIn({
        userId: user.id,
        email: user.email,
        provider: account?.provider,
        emailVerified: profile?.email_verified === true,
        accessToken: account?.access_token ?? undefined,
      });
    },
  },
});

// Each export is annotated with its NextAuthResult member type: a destructured
// re-export re-infers the type and trips TS2742 on `auth`.
export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
