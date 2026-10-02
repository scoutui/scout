---
"@scoutui/cli": patch
---

`scout init --framework vue`, or picking only Vue when `init` asks, now writes an `include` that finds your files: `src/**/*.{js,jsx,ts,tsx,vue}`. Before, it wrote `src/**/*.{vue}`, which matched no files, so the scan found nothing. Scout reads your `.ts` and `.js` files as well as `.vue` ones, because components imported through an `index.ts` are only credited to the right `.vue` file when Scout can read the index. If you ran `init` for Vue before this release, change `include` in `scout.config.json` to `src/**/*.{js,jsx,ts,tsx,vue}`.
