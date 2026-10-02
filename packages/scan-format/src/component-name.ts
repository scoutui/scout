/**
 * Whether two spellings name the same component the way Vue matches a template tag to a component: letter case and
 * hyphens don't count, so `settings-header`, `settingsHeader` and `SettingsHeader` are one name.
 */
export function sameComponentName(a: string, b: string): boolean {
  return fold(a) === fold(b);
}

function fold(name: string): string {
  return name.toLowerCase().replaceAll("-", "");
}
