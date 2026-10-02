---
"@scoutui/web-app": patch
---

The dashboard's JSON API names a scan's commit date `committedAt` instead of `scannedAt`: in `/api/repos`, `/api/repos/{repoId}` (and its `diff.baselineCommittedAt`), `/api/repos/{repoId}/scans` and the `cells` of `/api/packages/{packageName}`.
