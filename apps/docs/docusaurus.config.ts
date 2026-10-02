import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { createRequire } from "node:module";
import { themes as prismThemes } from "prism-react-renderer";

const require = createRequire(import.meta.url);

// Code-block themes: syntax-token colours from the stock light/dark Prism
// themes, but the surface (background + plain text) retinted onto the product's
// neutral-cool tokens so code blocks sit inside the monochrome system — light
// blocks on light pages, dark on dark — rather than a dark slab on both.
const lightCodeTheme = {
  ...prismThemes.github,
  plain: {
    ...prismThemes.github.plain,
    backgroundColor: "var(--pal-neutral-canvas)",
    color: "var(--pal-neutral-ink)",
  },
};
const darkCodeTheme = {
  ...prismThemes.vsDark,
  plain: {
    ...prismThemes.vsDark.plain,
    backgroundColor: "var(--pal-neutral-mist)",
    color: "var(--pal-neutral-ink)",
  },
};

const config: Config = {
  title: "Scout",
  tagline: "Design-system usage analytics for React and Vue",
  favicon: "img/favicon.svg",

  url: "https://scoutui.dev",
  baseUrl: "/",

  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  onBrokenMarkdownLinks: "throw",

  i18n: { defaultLocale: "en", locales: ["en"] },

  plugins: [
    [
      "docusaurus-plugin-llms",
      {
        generateLLMsTxt: true,
        generateLLMsFullTxt: true,
      },
    ],
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: [require.resolve("@scoutui/palette/palette.css"), "./src/css/custom.css"],
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/social-card.png",
    navbar: {
      title: "Scout",
      logo: {
        src: "img/mark.svg",
        srcDark: "img/mark-dark.svg",
        width: 24,
        height: 24,
      },
      items: [
        { type: "doc", docId: "intro", label: "Docs", position: "left" },
        {
          // The GitHub mark from Octicons (MIT). The label shows only in the phone menu.
          href: "https://github.com/scoutui/scout",
          html: '<svg class="navbar-github__mark" width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/></svg><span class="navbar-github__label">GitHub</span>',
          position: "right",
          className: "navbar-github",
          "aria-label": "Scout on GitHub",
        },
        {
          to: "/docs/tutorials/scan-your-first-repo",
          label: "Get started",
          position: "right",
          className: "navbar-cta",
        },
      ],
    },
    footer: {
      links: [
        {
          title: "Documentation",
          items: [
            { label: "Overview", to: "/docs/overview" },
            {
              label: "Scan your first repo",
              to: "/docs/tutorials/scan-your-first-repo",
            },
            { label: "Install the CLI", to: "/docs/guides/install" },
            { label: "CLI reference", to: "/docs/reference/cli" },
          ],
        },
        {
          title: "Concepts",
          items: [
            { label: "How components are found", to: "/docs/explanation/mental-model" },
            {
              label: "The CLI and the dashboard",
              to: "/docs/explanation/cli-and-dashboard",
            },
            {
              label: "Reading the numbers",
              to: "/docs/explanation/dashboard/reading-the-numbers",
            },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/scoutui/scout",
            },
            { label: "llms.txt", to: "pathname:///llms.txt" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Ben Siggery.`,
    },
    prism: {
      theme: lightCodeTheme,
      darkTheme: darkCodeTheme,
      additionalLanguages: ["bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
