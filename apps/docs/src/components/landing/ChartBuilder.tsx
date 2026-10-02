import type React from "react";
import clsx from "clsx";
import { BUTTON_UI, MONTHS } from "./acme";
import { straightPath, toPoints } from "./chartPath";
import Code from "./Code";
import shared from "./shared.module.css";
import styles from "./ChartBuilder.module.css";
import useDrawOnView from "./useDrawOnView";

const TITLE = "Core components";

type Hue = "teal" | "violet" | "blue";

/** A component series: its package, its colour and its uses in every scan, October to September, across all repos. */
type Series = { name: string; pkg: string; hue: Hue; uses: readonly number[] };

/**
 * Three components from the current library, coloured as the web app colours a saved chart's series: teal, violet
 * and blue by their place in the list.
 */
const SERIES: readonly Series[] = [
  { name: "Button", pkg: "@acme/ui", hue: "teal", uses: BUTTON_UI },
  { name: "Dialog", pkg: "@acme/ui", hue: "violet", uses: [34, 34, 41, 44, 44, 58, 61, 61, 74, 83, 97, 118] },
  { name: "Tabs", pkg: "@acme/ui", hue: "blue", uses: [0, 0, 0, 0, 4, 9, 9, 14, 18, 26, 33, 41] },
];

/** Month indexes that keep their tick label on phones. */
const PHONE_TICKS: ReadonlySet<number> = new Set([0, 3, 6, 11]);

const Y_MAX = 600;
const GRIDLINES = [0, 200, 400, 600];

const top = (v: number) => `${(1 - v / Y_MAX) * 100}%`;
const x = (i: number) => `${(i / (MONTHS.length - 1)) * 100}%`;
const last = (s: Series) => s.uses[s.uses.length - 1];
const keyOf = (s: Series) => `${s.name} ${s.pkg}`;

const SUMMARY = `Example chart builder: a trend chart named ${TITLE}, counting uses across all repos in every monthly scan from October to September. ${SERIES.map(
  (s) => `${s.name} from ${s.pkg} went from ${s.uses[0]} to ${last(s)} uses`,
).join(", ")}.`;

/**
 * The dashboard's chart builder with a saved trend of three components: lines only, each labelled at its end by
 * name alone, as the web app labels line ends. The legend chips carry the packages.
 */
export default function ChartBuilder(): React.ReactElement {
  const draw = useDrawOnView<HTMLElement>();
  return (
    <figure ref={draw.ref} className={styles.figure} data-draw={draw.state}>
      <div className={styles.fade}>
        <div className={clsx(shared.panel, styles.panel)} role="img" aria-label={SUMMARY}>
          <div className={styles.controls}>
            <p className={styles.titleRow}>
              <span className={styles.title}>{TITLE}</span>
              <span className={styles.scope}>All repos</span>
            </p>
          </div>

          <div className={styles.body}>
            <ul className={styles.chips}>
              {SERIES.map((s) => (
                <li key={keyOf(s)} className={clsx(styles.chip, styles[s.hue])}>
                  <span className={clsx(shared.swatch, styles.swatch)} />
                  <span className={styles.chipLabel}>
                    <Code className={styles.chipName}>{s.name}</Code>
                    <Code className={styles.chipPackage}>{s.pkg}</Code>
                  </span>
                </li>
              ))}
            </ul>

            <div className={styles.chart} dir="ltr">
              <div className={styles.yAxis}>
                <span className={clsx(styles.yTick, shared.num)} style={{ top: top(Y_MAX) }}>
                  {Y_MAX}
                </span>
                <span className={clsx(styles.yTick, shared.num)} style={{ top: top(0) }}>
                  0
                </span>
              </div>

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
                    {SERIES.map((s) => (
                      <path
                        key={keyOf(s)}
                        className={clsx(styles.line, styles[s.hue])}
                        d={straightPath(toPoints(s.uses, Y_MAX))}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                  {SERIES.map((s) => (
                    <span key={keyOf(s)} className={clsx(styles.dot, styles[s.hue])} style={{ top: top(last(s)) }} />
                  ))}
                </div>
              </div>

              <div className={clsx(styles.ends, shared.afterDraw)}>
                {SERIES.map((s) => (
                  <span key={keyOf(s)} className={styles.end} style={{ top: top(last(s)) }}>
                    <Code>{s.name}</Code>
                  </span>
                ))}
              </div>

              <div className={styles.xAxis}>
                {MONTHS.map((m, i) => (
                  <span
                    key={m}
                    className={clsx(styles.xTick, !PHONE_TICKS.has(i) && styles.minor)}
                    style={{ left: x(i) }}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
