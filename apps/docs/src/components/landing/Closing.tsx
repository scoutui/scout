import type React from "react";
import Link from "@docusaurus/Link";
import clsx from "clsx";
import { ArrowRight } from "./Icons";
import { DEPLOY_DASHBOARD, REPO_URL, SCAN_FIRST_REPO } from "./product";
import Stage, { StageHead } from "./Stage";
import shared from "./shared.module.css";
import styles from "./Closing.module.css";

const SELF_HOSTED: readonly string[] = [
  "One Docker image or a Helm chart, and a Postgres database",
  "Your own sign-in, through any OIDC provider",
  "Scans uploaded from CI or a laptop",
  "Open source, MIT licensed",
];

/** The last stop on the life line: running the dashboard yourself. */
export function SelfHosted(): React.ReactElement {
  return (
    <Stage id="self-hosted" word="Self-hosted" variant="last">
      <div className={shared.col}>
        <StageHead id="self-hosted" title="Run it on your own infrastructure" />
        <ul className={styles.facts}>
          {SELF_HOSTED.map((fact) => (
            <li key={fact} className={styles.fact}>
              {fact}
            </li>
          ))}
        </ul>
        <p className={styles.deploy}>
          <Link className={shared.textLink} to={DEPLOY_DASHBOARD}>
            Deploy the dashboard
            <ArrowRight />
          </Link>
        </p>
      </div>
    </Stage>
  );
}

export function Close(): React.ReactElement {
  return (
    <section className={styles.close} aria-labelledby="start-title">
      <div className={shared.container}>
        <h2 id="start-title" className={styles.closeTitle}>
          Point it at a repo you already have
        </h2>
        <div className={clsx(shared.actions, styles.closeActions)}>
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
    </section>
  );
}
