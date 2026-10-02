import type React from "react";
import clsx from "clsx";
import shared from "./shared.module.css";
import styles from "./TrackingRow.module.css";

/** The heading over a list of tracking rows, carrying the count: "Migrations · 2 active". */
export function TrackingHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className={clsx(styles.heading, shared.num)}>{children}</p>;
}

/**
 * One row of the web app's migration and retirement lists: what is tracked, where it stands ("74% migrated",
 * "31 remaining") and the change since the last scan, then an optional mini trend. A migration's level is green
 * while it moves forward; a retirement's stays in ink. A migration's successor sits beneath the label as a quieter
 * "to …" line at every width, so the pair never reflows. Below 1280px the numbers drop below, as the web app's do.
 */
export default function TrackingRow({
  label,
  to,
  value,
  gain,
  unit,
  delta,
  mini,
}: {
  label: React.ReactNode;
  /** A migration's successor, set beneath the label after a muted "to". */
  to?: React.ReactNode;
  value: React.ReactNode;
  gain?: boolean;
  unit: string;
  delta: string;
  mini?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.row}>
      <span className={styles.label}>
        <span className={styles.line}>{label}</span>
        {to ? (
          <span className={clsx(styles.line, styles.to)}>
            <span className={styles.toWord}>to</span>
            {to}
          </span>
        ) : null}
      </span>
      <span className={styles.numbers}>
        <span className={styles.readout}>
          <span className={clsx(styles.value, shared.num, gain ? shared.gain : styles.ink)}>{value}</span> {unit}
        </span>
        <span className={clsx(styles.delta, shared.gain, shared.num)}>{delta}</span>
        {mini}
      </span>
    </div>
  );
}
