import type React from "react";
import clsx from "clsx";
import Code from "./Code";
import shared from "./shared.module.css";
import styles from "./UsageFigure.module.css";
import Where from "./Where";

type Value = { label: string; count: number; selected?: boolean };

/** The `variant` values `@acme/ui`'s Button is given in partner-portal, sorted by count as the dashboard lists them. */
const VARIANT: readonly Value[] = [
  { label: "primary", count: 17 },
  { label: "secondary", count: 9 },
  { label: "danger", count: 3, selected: true },
  { label: "ghost", count: 3 },
];

const VARIANT_MAX = VARIANT[0].count;
const VARIANT_TOTAL = VARIANT.reduce((sum, v) => sum + v.count, 0);

type FileGroup = { dir: string; base: string; lines: readonly number[] };

/** Call sites that pass variant="danger", in the dashboard's order. */
const FILES: readonly FileGroup[] = [
  { dir: "src/orders/", base: "OrderTable.tsx", lines: [88, 112] },
  { dir: "src/components/", base: "ConfirmDialog.tsx", lines: [34] },
];

const FILE_COUNT = 2;
const CALL_COUNT = 3;
const SELECTION = "variant=danger";

/**
 * The Usage tab of `@acme/ui`'s Button in partner-portal, filtered to `variant=danger`: the props rail and the call
 * sites in one panel, side by side from 768px and stacked below. Laid out left to right whatever the page
 * direction, as the web app is.
 */
export default function UsageFigure(): React.ReactElement {
  return (
    <figure className={styles.figure}>
      <Where repo="partner-portal" name="Button" pkg="@acme/ui" />

      <div className={clsx(shared.panel, styles.frame)} dir="ltr">
        <div className={styles.values}>
          <p className={styles.band}>
            <span className={shared.label}>Prop values</span>
          </p>
          <div className={styles.facet}>
            <p className={styles.facetHead}>
              <Code className={styles.facetName}>variant</Code>
              <span className={clsx(styles.small, shared.num)}>{VARIANT_TOTAL}</span>
            </p>
            <ul className={styles.valueList}>
              {VARIANT.map((v) => (
                <li key={v.label} className={clsx(styles.value, v.selected && styles.selected)}>
                  <Code className={styles.valueLabel}>{v.label}</Code>
                  {v.selected ? <span className={shared.srOnly}>(selected)</span> : null}
                  <span className={styles.track} aria-hidden="true">
                    <span
                      className={styles.fill}
                      style={{ width: `${Math.round((100 * v.count) / VARIANT_MAX)}%` }}
                    />
                  </span>
                  <span className={clsx(styles.valueCount, shared.num)}>{v.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={styles.sites}>
          <p className={styles.band}>
            <span className={shared.label}>
              Uses<Code className={styles.selection}>· {SELECTION}</Code>
            </span>
            <span className={clsx(styles.small, shared.num)}>
              {FILE_COUNT} files · {CALL_COUNT} uses
            </span>
          </p>

          <ul className={styles.files}>
            {FILES.map((f) => (
              <li key={f.base} className={styles.file}>
                <p className={styles.fileRow}>
                  <Code className={styles.path}>
                    <span className={styles.dir}>{f.dir}</span>
                    <span className={styles.base}>{f.base}</span>
                  </Code>
                  <span className={clsx(styles.small, shared.num)}>
                    {f.lines.length} {f.lines.length === 1 ? "use" : "uses"}
                  </span>
                </p>
                <ol className={styles.calls}>
                  {f.lines.map((line) => (
                    <li key={line} className={styles.call}>
                      <Code className={styles.lineNo}>:{line}</Code>
                      <Code className={styles.chip}>
                        <span className={styles.chipName}>variant=</span>
                        <span className={styles.chipHit}>danger</span>
                      </Code>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </figure>
  );
}
