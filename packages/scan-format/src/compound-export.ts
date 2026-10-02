export function parseCompoundExport(exportName: string): {
  root: string;
  path: string[];
  isCompound: boolean;
} {
  const [root, ...path] = exportName.split(".");
  return {
    root: root ?? "",
    path,
    isCompound: path.length > 0,
  };
}
