import type React from "react";
import clsx from "clsx";
import Code from "./Code";
import styles from "./RenderTreeFigure.module.css";
import Where from "./Where";

/** Components in partner-portal whose JSX renders `@acme/ui`'s Button, and the pages and layout that render those. */
const DIRECT = ["PaymentForm", "OrderTable", "ConfirmDialog", "Header"];
const FURTHER_UP = ["CheckoutPage", "OrdersPage", "AccountPage", "AppLayout"];

/** Row centres in the tree's 250-unit-high box, one per named component, then the overflow row. */
const ROWS = [60, 100, 140, 180, 220];
const FOCUS_Y = 140;
const OVERFLOW_ROW = ROWS.length - 1;

/**
 * Which further-up component renders which direct one, by row: CheckoutPage renders PaymentForm, OrdersPage renders
 * OrderTable and ConfirmDialog, AccountPage renders ConfirmDialog, and AppLayout renders Header. The router wraps
 * each page in the layout, so no page renders AppLayout itself.
 */
const UP_EDGES: readonly [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 1],
  [2, 2],
  [3, 3],
  [4, 4],
];

/**
 * Column edges in percent of the tree's width, from the inline-start edge; they match the node columns in the CSS
 * module. Button reaches 22% across, so the edges start there.
 */
const G = { start: 22, directLeft: 28, directRight: 62, upLeft: 66 };

function Edges(): React.ReactElement {
  const fan = (y: number) => {
    const mid = (G.start + G.directLeft) / 2;
    return `M${G.start},${FOCUS_Y} C${mid},${FOCUS_Y} ${mid},${y} ${G.directLeft},${y}`;
  };
  const across = (from: number, to: number) => {
    const mid = (G.directRight + G.upLeft) / 2;
    return `M${G.directRight},${from} C${mid},${from} ${mid},${to} ${G.upLeft},${to}`;
  };
  return (
    <g>
      {ROWS.map((y) => (
        <path key={`d${y}`} className={styles.edge} d={fan(y)} vectorEffect="non-scaling-stroke" />
      ))}
      {UP_EDGES.map(([from, to]) => (
        <path
          key={`u${from}-${to}`}
          className={styles.edge}
          d={across(ROWS[from], ROWS[to])}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

const SUMMARY = `Composition of the Button from @acme/ui in partner-portal. ${DIRECT.join(", ")} and more components render it directly. Further up, CheckoutPage renders PaymentForm, OrdersPage renders OrderTable and ConfirmDialog, AccountPage renders ConfirmDialog, AppLayout renders Header, and more.`;

/** The tree grows away from the life line, so it mirrors with the page direction. */
export default function RenderTreeFigure(): React.ReactElement {
  return (
    <figure className={styles.figure}>
      <div className={styles.head}>
        <Where repo="partner-portal" name="Button" pkg="@acme/ui" />
      </div>
      <div className={styles.tree} role="img" aria-label={SUMMARY}>
        <p className={clsx(styles.columnHead, styles.direct)} aria-hidden="true">
          Directly
        </p>
        <p className={clsx(styles.columnHead, styles.up)} aria-hidden="true">
          Further up
        </p>

        <svg
          className={styles.edges}
          viewBox="0 0 100 250"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <Edges />
        </svg>

        <span className={clsx(styles.node, styles.focus)} aria-hidden="true">
          <span className={styles.focusName}>
            <Code>Button</Code>
          </span>
          <Code className={styles.focusPackage}>@acme/ui</Code>
        </span>

        {DIRECT.map((name, row) => (
          <span
            key={name}
            className={clsx(styles.node, styles.direct)}
            style={{ top: ROWS[row] - 15 }}
            aria-hidden="true"
          >
            <Code>{name}</Code>
          </span>
        ))}
        <span
          className={clsx(styles.node, styles.direct, styles.more)}
          style={{ top: ROWS[OVERFLOW_ROW] - 15 }}
          aria-hidden="true"
        >
          More
        </span>

        {FURTHER_UP.map((name, row) => (
          <span
            key={name}
            className={clsx(styles.node, styles.up)}
            style={{ top: ROWS[row] - 15 }}
            aria-hidden="true"
          >
            <Code>{name}</Code>
          </span>
        ))}
        <span
          className={clsx(styles.node, styles.up, styles.more)}
          style={{ top: ROWS[OVERFLOW_ROW] - 15 }}
          aria-hidden="true"
        >
          More
        </span>
      </div>
    </figure>
  );
}
