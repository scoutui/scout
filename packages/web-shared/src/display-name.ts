import { sameComponentName } from "@scoutui/scan-format";

/** An occurrence's written name when it names the component differently from `displayName` (`sameComponentName`). */
export function shownWrittenName(writtenName: string | undefined, displayName: string): string | undefined {
  return writtenName !== undefined && !sameComponentName(writtenName, displayName) ? writtenName : undefined;
}
