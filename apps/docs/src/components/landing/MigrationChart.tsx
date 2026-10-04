import type React from "react";
import clsx from "clsx";
import { BUTTON_MIGRATION, MAJOR_TICKS, MONTHS, PACKAGE_MIGRATION, SCANS } from "./acme";
import { areaPath, straightPath, toPoints } from "./chartPath";
import Code from "./Code";
import { TriangleAlert } from "./Icons";
import shared from "./shared.module.css";
import styles from "./MigrationChart.module.css";
import TrackingRow, { TrackingHeading } from "./TrackingRow";
import useDrawOnView from "./useDrawOnView";

const Y_MAX = 7000;
const GRIDLINES = [0, 2000, 4000, 6000];

const LEGACY = SCANS.map((s) => s.legacy);
const SUCCESSOR = SCANS.map((s) => s.ui);
const legacyPoints = toPoints(LEGACY, Y_MAX);
const successorPoints = toPoints(SUCCESSOR, Y_MAX);

const top = (v: number) => `${(1 - v / Y_MAX) * 100}%`;
const x = (i: number) => `${(i / (MONTHS.length - 1)) * 100}%`;

const lastLegacy = LEGACY[LEGACY.length - 1];
const lastSuccessor = SUCCESSOR[SUCCESSOR.length - 1];

const SUMMARY = `Two migrations. The whole @acme/legacy-ui package, replaced by @acme/ui: ${PACKAGE_MIGRATION.now} migrated, ${PACKAGE_MIGRATION.delta}. Its chart shows uses of @acme/legacy-ui falling while uses of @acme/ui rose, over twelve monthly scans across all repos. One component, the legacy Button, replaced by the Button from @acme/ui: ${BUTTON_MIGRATION.now} migrated, ${BUTTON_MIGRATION.delta}.`;

/* The package migration's pair, keyed as its chart draws them. */
const PACKAGE_FROM = (
  <>
    <TriangleAlert className={shared.warnGlyph} />
    <Code>@acme/legacy-ui</Code>
  </>
);
const PACKAGE_TO = (
  <>
    <span className={clsx(shared.swatch, shared.swatchSuccessor)} />
    <Code>@acme/ui</Code>
  </>
);

/**
 * The migrations section of the dashboard's Charts page: the package's row opened onto its chart, the counts of
 * the deprecated package and its successor over scans, then one component's row. Time runs left to right whatever
 * the page direction, so the figure is always laid out left to right.
 */
export default function MigrationChart(): React.ReactElement {
  const draw = useDrawOnView<HTMLElement>();
  return (
    <figure ref={draw.ref} className={styles.figure} dir="ltr" data-draw={draw.state}>
      <TrackingHeading>Migrations · 2 in progress</TrackingHeading>
      <div className={clsx(shared.panel, styles.panel)} role="img" aria-label={SUMMARY}>
        <TrackingRow
          label={PACKAGE_FROM}
          to={PACKAGE_TO}
          value={PACKAGE_MIGRATION.now}
          gain
          unit="migrated"
          delta={PACKAGE_MIGRATION.delta}
        />

        <div className={styles.chart} aria-hidden="true">
          <div className={styles.plot}>
            <svg
              className={styles.svg}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              {GRIDLINES.map((value) => (
                <line
                  key={value}
                  className={value === 0 ? styles.baseline : styles.gridline}
                  x1="0"
                  x2="100"
                  y1={(1 - value / Y_MAX) * 100}
                  y2={(1 - value / Y_MAX) * 100}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div className={clsx(styles.series, shared.drawn)}>
              <svg
                className={styles.svg}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <linearGradient id="landing-migration-wash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" className={styles.washTop} />
                    <stop offset="1" className={styles.washBottom} />
                  </linearGradient>
                </defs>
                <path d={areaPath(successorPoints)} fill="url(#landing-migration-wash)" />
                <path
                  className={clsx(styles.line, styles.successor)}
                  d={straightPath(successorPoints)}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  className={clsx(styles.line, styles.legacy)}
                  d={straightPath(legacyPoints)}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className={clsx(styles.dot, styles.dotSuccessor)} style={{ top: top(lastSuccessor) }} />
              <span className={clsx(styles.dot, styles.dotLegacy)} style={{ top: top(lastLegacy) }} />
            </div>
          </div>

          <div className={styles.xAxis}>
            {MONTHS.map((m, i) => (
              <span
                key={m}
                className={clsx(styles.xTick, !MAJOR_TICKS.has(i) && styles.minor)}
                style={{ left: x(i) }}
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        <TrackingRow
          label={<Code>Button · @acme/legacy-ui</Code>}
          to={<Code>Button · @acme/ui</Code>}
          value={BUTTON_MIGRATION.now}
          gain
          unit="migrated"
          delta={BUTTON_MIGRATION.delta}
        />
      </div>
    </figure>
  );
}
