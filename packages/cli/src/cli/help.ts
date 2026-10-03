const TOP = `scout <command> [options]

Commands:
  scan          Scan the repo and upload the scan to the dashboard
  backfill      Scan one commit a week of the tracked branch's history and upload each scan
  init          Scaffold scout.config.json
  auth          Sign in / out of a Scout host (login | logout | status)

Run \`scout <command> --help\` for command-specific options.

Other:
  --help, -h
  --version, -v
  --debug        Show the details behind an error (or set SCOUTUI_DEBUG=1)
`;

const SCAN = `scout scan [options]

Scan the repo and upload the scan to the dashboard.

Options:
  --config <path>    Override config path (default: ./scout.config.json)
  --quiet            Suppress STDOUT summary
  --repo-id <value>  Override repo identifier in the artifact
  --repo-root <dir>  Directory to treat as the repository root for artefact paths (default: git toplevel)
  --dry-run          Scan without uploading, and write scout-scan.json next to the config
  --rescan           Upload even if the dashboard already has this commit, replacing its scan
  --csv <path>       Also write every component the scan found to a CSV file
  --host <url>       Override host URL (else SCOUTUI_HOST, else host in scout.config.json, else your default host)
`;

const BACKFILL = `scout backfill [options]

Scan one commit a week of the tracked branch's history and upload each scan.

Options:
  --since <date>     Earliest commit date, as YYYY-MM-DD (default: six months ago)
  --rescan           Also scan commits the dashboard already has, replacing their scans
  --config <path>    Override config path (default: ./scout.config.json)
  --host <url>       Override host URL (else SCOUTUI_HOST, else host in scout.config.json, else your default host)
  --quiet            Hide the progress lines
  --debug            Also show each install's and each scan's output
`;

const INIT = `scout init [options]

Scaffold scout.config.json. Interactive when run in a terminal.

Options:
  --output <path>     Config output path (default: ./scout.config.json)
  --framework <name>  Pre-select a framework (repeatable): react | vue
  --repo-id <name>    Repository name on the dashboard (default: owner/name from the git remote, else the folder name)
  --host <url>        Dashboard address to save in the config
  --branch <name>     Branch the dashboard tracks (default: the remote's default branch)
  -y, --yes           Accept defaults without prompting (non-interactive)
`;

const AUTH = `scout auth <login|logout|status> [--host <url>]

  login   Device-flow browser login; saves your session in the system keychain, or in ~/.config/scoutui/hosts.json if the keychain can't be used
  logout  Revoke a session for a host
  status  Show the signed-in identity
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
