import type React from "react";
import clsx from "clsx";
import { CAROUSEL_REMAINING, RETIRED_DELTA, RETIRED_NOW } from "./acme";
import { straightPath } from "./chartPath";
import Code from "./Code";
import shared from "./shared.module.css";
import styles from "./RetirementFigure.module.css";
import TrackingRow, { TrackingHeading } from "./TrackingRow";
import useDrawOnView from "./useDrawOnView";

/** The web app's row mini: 112 by 32, inset 3, counts from zero at the bottom. */
const W = 112;
const H = 32;
const PAD = 3;

const max = Math.max(1, ...CAROUSEL_REMAINING);
const points = CAROUSEL_REMAINING.map(
  (v, i) => [PAD + (i / (CAROUSEL_REMAINING.length - 1)) * (W - 2 * PAD), H - PAD - (v / max) * (H - 2 * PAD)] as const,
);
const [lastX, lastY] = points[points.length - 1];
const line = straightPath(points);

/** The count trend of the uses left, in the deprecated orange. */
function Spark(): React.ReactElement {
  return (
    <svg
      className={clsx(styles.spark, shared.drawn)}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.sparkLine} d={line} />
      <circle className={styles.sparkDot} cx={lastX} cy={lastY} r={2} />
    </svg>
  );
}

/**
 * The retirements section of the dashboard's Charts page, holding one row: the component, the uses left and where,
 * and the change since the last scan. Laid out left to right whatever the page direction, as the web app is.
 */
export default function RetirementFigure(): React.ReactElement {
  const draw = useDrawOnView<HTMLElement>();
  return (
    <figure ref={draw.ref} className={styles.figure} dir="ltr" data-draw={draw.state}>
      <TrackingHeading>Retirements · 1 active</TrackingHeading>
      <div className={clsx(shared.panel, styles.panel)}>
        <TrackingRow
          label={<Code>Carousel · @acme/legacy-ui</Code>}
          value={RETIRED_NOW}
          unit="remaining in 2 repos"
          delta={RETIRED_DELTA}
          mini={<Spark />}
        />
      </div>
    </figure>
  );
}
