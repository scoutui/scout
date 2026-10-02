import type React from "react";
import clsx from "clsx";
import shared from "./shared.module.css";
import styles from "./Stage.module.css";

type Variant = "plain" | "band" | "last";

/**
 * One stop on the life line: its segment of the line, the marker, the stage label, then the content. A `joined`
 * stage carries on from the one before it, so it sits closer.
 */
export default function Stage({
  id,
  word,
  variant = "plain",
  joined = false,
  children,
}: {
  id: string;
  word: string;
  variant?: Variant;
  joined?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={clsx(styles.stage, variant !== "plain" && styles[variant], joined && styles.joined)}
    >
      <div className={clsx(shared.container, styles.frame)}>
        <span className={styles.marker} aria-hidden="true" />
        <p className={styles.rail}>{word}</p>
        {children}
      </div>
    </section>
  );
}

/** The stage heading, labelling its section. */
export function StageHead({ id, title }: { id: string; title: string }): React.ReactElement {
  return (
    <h2 id={`${id}-title`} className={shared.heading}>
      {title}
    </h2>
  );
}
