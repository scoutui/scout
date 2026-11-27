/** Where a name a use passes is listed: among the component's props, or under styling, events or attributes. */
export type PropGroup = "prop" | "styling" | "event" | "attribute";

const ATTRIBUTE = /^(data-|aria-)|^(key|ref)$/;
/** HTML attributes listed under Attributes for every component, unless it declares a prop of that name. */
const PASS_THROUGH = new Set(["id", "role", "tabIndex", "tabindex"]);
/** HTML attributes listed under Attributes only for a component with declared props that doesn't declare one of that name. */
const OTHER_HTML_ATTRIBUTE = new Set(["slot", "dir", "lang", "hidden", "title"]);
/**
 * Test ids: names that start with the word `qa` or `e2e` (`qa`, `qaSelector`, `qa-id`, `e2eId`), or end in the words
 * `test` and `id` (`testId`, `testID`, `test-id`, `dataTestId`). `latestId`, `quantity` and `TestId` don't match.
 */
const TEST_ID = /^(qa|e2e)(?![a-z])|(^|[-_])test[-_]?(id|Id|ID)$|[a-z]Test(Id|ID)$/;
const STYLING = new Set(["className", "class", "style", "sx", "css"]);

/**
 * The group of `name` on a component: `declared` when the component declares it, `events` the names the scan counts
 * as its events, and `hasDeclaredApi` when the scan read its declared props. Only `prop` names are the component's
 * own props: Top props, the Usage tab's props and the declared-prop verdicts list them, and nothing else.
 */
export function propGroup(name: string, declared: boolean, events: ReadonlySet<string>, hasDeclaredApi: boolean): PropGroup {
  const html = PASS_THROUGH.has(name) || (hasDeclaredApi && OTHER_HTML_ATTRIBUTE.has(name));
  if (ATTRIBUTE.test(name)) return "attribute";
  if (events.has(name)) return "event";
  if ((html && !declared) || TEST_ID.test(name)) return "attribute";
  if (STYLING.has(name)) return "styling";
  return "prop";
}
