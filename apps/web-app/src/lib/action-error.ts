/**
 * The sentence a form shows when one of its server actions fails. Actions
 * return the code `not_authenticated` when the session has ended, and a
 * finished sentence for any other failure they explain. `task` completes
 * "Sign in again to …"; `fallback` covers a failure with no text.
 */
export function actionErrorMessage(error: string | undefined, task: string, fallback: string): string {
  if (error === "not_authenticated") return `Your session has ended. Sign in again to ${task}.`;
  return error ?? fallback;
}
