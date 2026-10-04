import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    {
      type: "category",
      label: "Tutorials",
      link: { type: "generated-index" },
      items: ["tutorials/scan-your-first-repo", "tutorials/explore-the-dashboard"],
    },
    {
      type: "category",
      label: "How-to guides",
      link: { type: "generated-index" },
      items: [
        {
          type: "category",
          label: "Using the dashboard",
          items: [
            "guides/dashboard/repos",
            "guides/dashboard/find-where-a-component-is-used",
            "guides/dashboard/packages",
            "guides/dashboard/tag-your-libraries",
            "guides/dashboard/track-a-migration",
            "guides/dashboard/charts",
          ],
        },
        {
          type: "category",
          label: "Scanning with the CLI",
          items: [
            "guides/install",
            "guides/configure-a-scan",
            "guides/resolve-imports-in-a-monorepo",
            "guides/authenticate-uploads",
            "guides/run-in-ci",
            "guides/fill-in-a-repos-history",
            "guides/link-web-components-to-your-package",
            "guides/troubleshoot-a-scan",
          ],
        },
        {
          type: "category",
          label: "Running the dashboard",
          items: [
            "guides/run-the-dashboard-locally",
            "guides/deploy-the-dashboard",
            "guides/deploy-with-your-own-chart",
            "guides/manage-people-and-roles",
          ],
        },
        "guides/upgrade-scout",
      ],
    },
    {
      type: "category",
      label: "Reference",
      link: { type: "generated-index" },
      items: [
        "reference/glossary",
        "reference/cli",
        "reference/config",
        "reference/artifact",
        "reference/diagnostics",
        "reference/framework-support",
      ],
    },
    {
      type: "category",
      label: "Explanation",
      link: { type: "generated-index" },
      items: [
        "explanation/mental-model",
        "explanation/cli-and-dashboard",
        "explanation/dashboard/reading-the-numbers",
        "explanation/composition-and-ownership",
      ],
    },
  ],
};

export default sidebars;
