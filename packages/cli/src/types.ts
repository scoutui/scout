export type ResolvedConfig = {
  configPath: string;
  configDir: string;
  repoId?: string;
  host?: string;
  branch?: string;
  include?: string[];
  exclude: string[];
  gitignore: boolean;
  tsconfigPath?: string;
  aliases?: Record<string, string[]>;
  install?: string;
};
