## What and why

<!-- What this changes and why. Link the issue: "Closes #123".
     If it changes what the scanner reports or stores, say whether it's a
     local correction, a semantic change or a model change:
     https://github.com/scoutui/scout/blob/main/CODING_STANDARDS.md#changing-what-the-scanner-reports-or-stores
     On the scan format line, keep the answer that fits:
     https://github.com/scoutui/scout/blob/main/CODING_STANDARDS.md#changing-the-scan-format -->

**Scan format:** unchanged / additive / format change

## Checklist

- [ ] The title follows [Conventional Commits](https://github.com/scoutui/scout/blob/main/CONTRIBUTING.md#commits-and-pull-request-titles): `<type>(scope): <message>`
- [ ] A [changeset](https://github.com/scoutui/scout/blob/main/CONTRIBUTING.md#changesets) is added if someone using the CLI or the dashboard would notice the change (none for refactors or tests)
- [ ] Helm chart changes raise the chart's version and add a [changelog entry](https://github.com/scoutui/scout/blob/main/CONTRIBUTING.md#the-helm-chart)
- [ ] [The check](https://github.com/scoutui/scout/blob/main/CONTRIBUTING.md#the-check) passes: `yarn turbo run lint typecheck test build smoke`
- [ ] Scanner changes: a real repo was [scanned before and after](https://github.com/scoutui/scout/blob/main/CODING_STANDARDS.md#check-against-a-real-repo), and this PR says which counts changed
- [ ] User-facing docs under `apps/docs/docs/` are updated if behaviour changed
