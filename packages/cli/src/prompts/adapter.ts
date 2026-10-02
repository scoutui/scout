import * as clack from "@clack/prompts";

export type SelectOption<T> = { value: T; label: string; hint?: string };

export type PromptAdapter = {
  intro(message: string): void;
  outro(message: string): void;
  text(opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (value: string | undefined) => string | Error | undefined;
  }): Promise<string | symbol>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
  select<T>(opts: { message: string; options: SelectOption<T>[]; initialValue?: T }): Promise<T | symbol>;
  multiselect<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValues?: T[];
    required?: boolean;
  }): Promise<T[] | symbol>;
  spinner(): { start(message?: string): void; stop(message?: string): void };
  isCancel(value: unknown): value is symbol;
};

function clackSelect<T>(opts: { message: string; options: SelectOption<T>[]; initialValue?: T }): Promise<T | symbol> {
  return clack.select(opts as Parameters<typeof clack.select>[0]) as Promise<T | symbol>;
}

function clackMultiselect<T>(opts: {
  message: string;
  options: SelectOption<T>[];
  initialValues?: T[];
  required?: boolean;
}): Promise<T[] | symbol> {
  return clack.multiselect(opts as Parameters<typeof clack.multiselect>[0]) as Promise<T[] | symbol>;
}

/** Production adapter: delegates to @clack/prompts. */
export const clackAdapter: PromptAdapter = {
  intro: (m) => clack.intro(m),
  outro: (m) => clack.outro(m),
  text: (o) => clack.text(o),
  confirm: (o) => clack.confirm(o),
  select: clackSelect,
  multiselect: clackMultiselect,
  spinner: () => clack.spinner(),
  isCancel: (v): v is symbol => clack.isCancel(v),
};

/** Thrown when a prompt is cancelled (Ctrl-C). The router maps it to exit 130. */
export class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "PromptCancelledError";
  }
}

/** Unwrap a prompt result, converting clack's cancel sentinel into a throw. */
export function assertNotCancelled<T>(value: T | symbol, prompts: Pick<PromptAdapter, "isCancel">): T {
  if (prompts.isCancel(value)) throw new PromptCancelledError();
  return value as T;
}
