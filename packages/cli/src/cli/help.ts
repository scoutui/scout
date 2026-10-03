const TOP = `scout <command> [options]

Commands:
  scan          Scan the repo and upload the scan to the dashboard
  backfill      Scan one commit a week of the tracked branch's history and upload each scan
  init          Create scout.config.json for this repo
  auth          Sign in to a dashboard, check or sign out (login | status | logout)

Run \`scout <command> --help\` for command-specific options.

Other:
  --help, -h
  --version, -v
  --debug        Show the details behind an error (or set SCOUTUI_DEBUG=1)

Get started: scout init, then scout scan --dry-run.
Docs: https://scoutui.dev/docs
`;

const HOST = "  --host <url>       Dashboard address (default: SCOUTUI_HOST, else host in scout.config.json, else the first dashboard you signed in to)";
const CONFIG = "  --config <path>    Config file to read (default: ./scout.config.json)";

const SCAN = `scout scan [options]

Scan the repo and upload the scan to the dashboard.

Options:
${CONFIG}
  --quiet            Hide progress, the summary and most warnings
  --repo-id <name>   Repository name on the dashboard (default: repoId in the config, else from the git remote)
  --repo-root <dir>  Folder that paths in the scan file are relative to (default: the top of the git repository)
  --dry-run          Scan without uploading, and write scout-scan.json next to the config
  --rescan           Upload even if the dashboard already has this commit, replacing its scan
${HOST}
  --debug            Show the details behind an error
`;

const BACKFILL = `scout backfill [options]

Scan one commit a week of the tracked branch's history and upload each scan.

Options:
  --since <date>     Earliest commit date, as YYYY-MM-DD (default: six months ago)
  --rescan           Also scan commits the dashboard already has, replacing their scans
${CONFIG}
${HOST}
  --quiet            Hide the progress lines
  --debug            Also show each install's and each scan's output
`;

const INIT = `scout init [options]

Create scout.config.json for this repo. Asks for each setting when run in a terminal.

Options:
  --output <path>     Where to write the config (default: ./scout.config.json)
  --framework <name>  Pre-select a framework (repeatable): react | vue
  --repo-id <name>    Repository name on the dashboard (default: owner/name from the git remote, else the folder name)
  --host <url>        Dashboard address to save in the config
  --branch <name>     Branch the dashboard tracks (default: the remote's default branch)
  -y, --yes           Accept defaults without asking
  --debug             Show the details behind an error
`;

const AUTH = `scout auth <login|status|logout> [--host <url>]

  login   Sign in to a dashboard in your browser. Saves the session in the system keychain, or in ~/.config/scoutui/hosts.json if the keychain can't be used
  status  Show who you're signed in as
  logout  Sign out, ending the session on the dashboard
`;

const REGISTRY: Record<string, string> = { scan: SCAN, backfill: BACKFILL, init: INIT, auth: AUTH };

/** Top-level overview: `scout`, `scout --help`. */
export function topHelp(): string {
  return TOP;
}

/** Per-command usage: `scout <cmd> --help`. Falls back to the overview. */
export function commandHelp(command: string): string {
  return REGISTRY[command] ?? TOP;
}
