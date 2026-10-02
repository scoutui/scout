---
"@scoutui/web-app": patch
---

The Scans page now shows when each commit was made and when its scan reached the dashboard, and the banner on an older scan shows both. The **Last scan** columns are now called **Updated**: they show the date of the repo's latest commit, as before. A commit dated in the future no longer stays a repo's latest scan until that date passes: the dashboard places it by when its scan arrived.
