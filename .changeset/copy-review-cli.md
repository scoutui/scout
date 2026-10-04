---
"@scoutui/cli": patch
---

Clearer messages:

- A config error names the field and what's wrong with it, such as `"include" in ./scout.config.json can't be an empty list.`, in place of the schema's raw output. A config with the old `manifests` field gets the same message as any other field Scout doesn't use.
- Commands in messages print without backticks, like the rest of the CLI's messages.
- `scout auth login` says `To sign in, open:`. When the request is denied on the dashboard, it says so and how to try again.
- An unknown option with no close match points to the command's `--help`.
