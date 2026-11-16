---
"@scoutui/web-app": patch
---

Screen readers now hear which column is sorted, and in which direction, in the packages list, a package's "Used in" and "Components" tables, a component's "Used in" table and dashboard charts shown as a table. Names with numbers in them sort by number, so `Button2` comes before `Button10`. In the package and component searches of the chart builder and governance, and the Find box on a component's composition tab, pressing Enter to confirm Japanese, Chinese or Korean text no longer picks a result. When the browser refuses to copy a file list on the Usage tab, the Copy button now reads "Couldn't copy" and screen readers hear "Couldn't copy the list. Try again.", where before nothing happened. Where the browser doesn't allow copying at all, such as a dashboard served over plain http, the Copy buttons no longer show.
