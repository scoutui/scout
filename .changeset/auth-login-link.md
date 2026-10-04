---
"@scoutui/cli": patch
---

`scout auth login` prints the sign-in link with your code in it, such as `https://scout.example.com/login/device?code=HJKM-4TQX`, so it works when no browser opens. It says `Opening your browser…` rather than `Opened your browser…`, because it can't tell whether a browser opened. And when you have no default dashboard, for example after signing out of it, signing in to a dashboard you're already signed in to now makes it the default, so `scout auth status` and `scout scan` find it again without `--host`.
