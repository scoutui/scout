import cli from "../../../../packages/cli/package.json";

/** The version of the CLI in the commit this dashboard was built from, read when the dashboard is built. */
export const builtWithCli: string = cli.version;
