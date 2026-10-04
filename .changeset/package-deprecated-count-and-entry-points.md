---
"@scoutui/web-app": patch
---

The **Deprecated** column on the Packages page and the **deprecated components in use** line on a package page count each deprecated component once, as the package's **deprecated** chip does. Before, a component used in three repos counted three times. Components that share a name, such as `Button` from `@acme/ui` and from `@acme/ui/button`, show their entry point under the name on a package page's **Components** table and beside the package in the chart picker, as a repo's **Components** tab already does.
