import type React from "react";
import Link from "@docusaurus/Link";
import clsx from "clsx";
import Code from "./Code";
import { TriangleAlert } from "./Icons";
import { DEPLOY_DASHBOARD, REPO_URL, SCAN_FIRST_REPO } from "./product";
import shared from "./shared.module.css";
import styles from "./Hero.module.css";

type Row = {
  name: string;
  pkg: string;
  /** Absent on a removed row, which has no version or files now. */
  version?: string;
  files?: number;
  occurrences: number;
  /** Occurrences gained or lost since the previous scan. */
  delta: number;
  /** Superseded or retired. */
  deprecated?: boolean;
  mark?: "added" | "removed";
  selected?: boolean;
};

/**
 * partner-portal's changed view, sorted by the change since the previous scan with the biggest gain first (the
 * page opens on the biggest drop; one click on the Occurrences header flips it).
 */
const ROWS: readonly Row[] = [
  { name: "Button", pkg: "@acme/ui", version: "4.2.0", files: 17, occurrences: 38, delta: 9, selected: true },
  { name: "Tabs", pkg: "@acme/ui", version: "4.2.0", files: 2, occurrences: 3, delta: 3, mark: "added" },
  { name: "Dialog", pkg: "@acme/ui", version: "4.2.0", files: 7, occurrences: 9, delta: 2 },
  { name: "Modal", pkg: "@acme/legacy-ui", version: "2.14.0", files: 4, occurrences: 5, delta: -2, deprecated: true },
  { name: "TabBar", pkg: "@partner-portal/shared", occurrences: 0, delta: -3, mark: "removed" },
  { name: "Button", pkg: "@acme/legacy-ui", version: "2.14.0", files: 11, occurrences: 24, delta: -8, deprecated: true },
];

/** The web app's signed count: `+3`, `−12` with a real minus sign. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function describeRow(r: Row): string {
  const change = `${r.delta > 0 ? "up" : "down"} ${Math.abs(r.delta)}`;
  const state = r.mark === "removed" ? "removed" : r.mark === "added" ? `added, ${r.occurrences} occurrences` : `${r.occurrences} occurrences`;
  return `${r.name} from ${r.pkg}${r.deprecated ? " (deprecated)" : ""}, ${state}, ${change}`;
}

const SUMMARY = `Example repo page for partner-portal, showing what changed since the previous scan: 6 deprecated components in use; 2 added, 4 removed and 11 changed since the previous scan. The table lists the 17 components that moved: ${ROWS.map(describeRow).join("; ")}; and more. Lifted out of the first row, the top of the Button's page in partner-portal: an external React component from @acme/ui version 4.2.0, open on its Usage tab with 38 occurrences.`;

function Sep({ className }: { className?: string }): React.ReactElement {
  return <span className={clsx(styles.sep, className)}>·</span>;
}

/** The changed view's signed change beside a count, in ink. */
function Delta({ n }: { n: number }): React.ReactElement {
  return (
    <>
      (<span className={styles.deltaValue}>{signed(n)}</span>)
    </>
  );
}

function HeadCell({ label, num }: { label: string; num?: boolean }): React.ReactElement {
  return <span className={clsx(styles.head, num && styles.headNum)}>{label}</span>;
}

/** One component row: the columns from 640px up, and the stacked tiers the web app draws on phones. */
function TableRow({ r }: { r: Row }): React.ReactElement {
  const removed = r.mark === "removed";
  return (
    <div className={clsx(styles.row, r.selected && styles.selected, removed && styles.ghost)}>
      <span className={clsx(styles.cell, styles.nameCell)}>
        <span className={styles.nameLine}>
          <Code className={styles.rowName}>{r.name}</Code>
          {r.deprecated ? <TriangleAlert className={styles.rowWarn} /> : null}
          {r.mark ? <span className={styles.markBadge}>{r.mark}</span> : null}
        </span>
        <span className={styles.tier}>
          <Code>{r.pkg}</Code>
          {r.version ? (
            <>
              <Sep />
              <Code>{r.version}</Code>
            </>
          ) : null}
        </span>
        <span className={styles.tier}>
          <span>
            <span className={removed ? styles.faint : styles.ink}>{r.occurrences}</span> occurrences{" "}
            <Delta n={r.delta} />
          </span>
          {r.files === undefined ? null : (
            <>
              <Sep />
              <span>{r.files} files</span>
            </>
          )}
        </span>
      </span>
      <span className={clsx(styles.cell, styles.pkgCell)}>
        <Code>{r.pkg}</Code>
      </span>
      <span className={clsx(styles.cell, styles.versionCell)}>
        {r.version ? <Code>{r.version}</Code> : <span className={styles.faint}>—</span>}
      </span>
      <span className={clsx(styles.cell, styles.numCell)}>
        {r.files === undefined ? <span className={styles.faint}>—</span> : r.files}
      </span>
      <span className={clsx(styles.cell, styles.numCell)}>
        <span className={removed ? styles.faint : undefined}>{r.occurrences}</span>{" "}
        <span className={styles.slot}>
          <Delta n={r.delta} />
        </span>
      </span>
    </div>
  );
}

/** The top of the Button's page in partner-portal, as the web app heads a component page. */
function ComponentHeader(): React.ReactElement {
  return (
    <div className={styles.lift}>
      <p className={styles.liftBack}>
        <Code>partner-portal</Code>
      </p>
      <p className={styles.liftIdentity}>
        <Code className={styles.liftName}>Button</Code>
        <span className={clsx(styles.badge, styles.badgeSecondary)}>external</span>
        <span className={clsx(styles.badge, styles.badgeOutline)}>React</span>
      </p>
      <p className={styles.liftMeta}>
        <Code>@acme/ui</Code>
        <Sep className={styles.liftSep} />
        <Code>v4.2.0</Code>
      </p>
      <p className={styles.liftTabs}>
        <span className={clsx(styles.liftTab, styles.liftTabActive)}>
          <span className={styles.liftTabLabel}>Usage</span>
          <span className={clsx(styles.liftTabCount, shared.num)}>38</span>
        </span>
        <span className={styles.liftTab}>Composition</span>
        <span className={styles.liftTab}>Events</span>
      </p>
    </div>
  );
}

/**
 * partner-portal's repo page in its changed view, with the Button's own page header lifted out of its
 * row into a card the life line starts from. Laid out left to right whatever the page direction, as the web
 * app is.
 */
function ProductView(): React.ReactElement {
  return (
    <figure className={styles.view} dir="ltr">
      <div className={styles.shot} role="img" aria-label={SUMMARY}>
        <div className={styles.window}>
          <div className={styles.masthead}>
            <p className={styles.back}>Repos</p>
            <p className={styles.repoId}>
              <Code>partner-portal</Code>
            </p>
            <p className={styles.meta}>
              <Code>github.com/acme/partner-portal</Code>
              <Sep />
              <span>
                commit <Code>a41c9e2b</Code>
              </span>
              <Sep />
              <span>
                branch <Code>main</Code>
              </span>
              <Sep />
              <span>scanned 2h ago</span>
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.alarm}>
              <TriangleAlert className={styles.statusGlyph} />
              <span>
                <b className={shared.num}>6</b> deprecated components in use
              </span>
            </span>
            <span className={clsx(styles.diffText, shared.num)}>
              <b>2</b> added <Sep /> <b>4</b> removed <Sep /> <b>11</b> changed since previous scan
            </span>
          </div>

          <div className={styles.tabs}>
            <span className={clsx(styles.tab, styles.tabActive)}>Components</span>
            <span className={styles.tab}>Adoption</span>
          </div>

          <div className={styles.panel}>
            <div className={styles.filterBar}>
              <span className={styles.statusChip}>since previous scan</span>
              <span className={clsx(styles.count, shared.num)}>17 moved</span>
            </div>

            <div className={styles.table}>
              <div className={clsx(styles.row, styles.headRow)}>
                <HeadCell label="Component" />
                <HeadCell label="Package" />
                <HeadCell label="Version" />
                <HeadCell label="Files" num />
                <HeadCell label="Occurrences" num />
              </div>
              {ROWS.map((r) => (
                <TableRow key={`${r.name} ${r.pkg}`} r={r} />
              ))}
            </div>
          </div>
        </div>

        <ComponentHeader />
      </div>
    </figure>
  );
}

export default function Hero(): React.ReactElement {
  return (
    <>
      <header className={styles.hero}>
        <div className={shared.container}>
          <div className={styles.intro}>
            <h1 className={styles.title}>What your code says about your components</h1>
            <div className={styles.pitch}>
              <p className={styles.lede}>
                <span className={styles.sentence}>
                  Usage analytics for design-system teams, built for React and Vue.
                </span>{" "}
                <span className={styles.sentence}>
                  Open source and <span className={shared.nowrap}>self-hosted</span>, so nothing leaves your
                  infrastructure.
                </span>
              </p>
              <div className={clsx(shared.actions, styles.actions)}>
                <Link className={clsx(shared.button, shared.primary)} to={SCAN_FIRST_REPO}>
                  Scan your first repo
                </Link>
                <Link className={clsx(shared.button, shared.outline)} to={DEPLOY_DASHBOARD}>
                  Deploy the dashboard
                </Link>
                <Link className={clsx(shared.textLink, shared.github)} to={REPO_URL}>
                  GitHub
                </Link>
              </div>
            </div>
          </div>
          <ProductView />
        </div>
      </header>
      <div className={styles.origin}>
        <div className={clsx(shared.container, styles.originFrame)}>
          <span className={styles.start} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}
