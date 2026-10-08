import "./globals.css";
import "@fontsource/geologica/600.css";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/500.css";
import "@fontsource/monaspace-neon/600.css";
import { Mona_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Suspense } from "react";
import { TopTabs } from "@/components/nav/top-tabs";
import { AccountMenu } from "@/components/auth/account-menu";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";

const monaSans = Mona_Sans({
  subsets: ["latin"],
  variable: "--font-mona-sans",
  display: "swap",
});

export const metadata = {
  title: { default: "Scout", template: "%s · Scout" },
};

// Runs before first paint to set the `dark` class so the persisted/OS theme is
// applied with no flash. Must stay in sync with the resolution in
// theme-provider.tsx. Inlined as a string (no deps) so it executes synchronously
// in <head> ahead of hydration.
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var dark=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set by the middleware with the page's Content-Security-Policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const identity = await identify({ browser: true });
  const person = identity?.kind === "person" ? identity : null;
  return (
    <html lang="en" className={monaSans.variable} suppressHydrationWarning>
      <head>
        {/* Browsers hide a nonce from the page once they've checked it, so React
            would see a mismatch on hydration. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, no-input constant; required for synchronous pre-paint theme init */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <TopTabs
            showGovernance={can(person, "edit")}
            rightSlot={<AccountMenu person={person} />}
          />
          <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
            {/* Lets the page wait for its code inside a boundary while it hydrates, so React 19.2
                doesn't fail to hydrate <main> (facebook/react#35494). */}
            <Suspense>{children}</Suspense>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
