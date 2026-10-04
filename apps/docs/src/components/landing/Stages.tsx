import type React from "react";
import clsx from "clsx";
import ChartBuilder from "./ChartBuilder";
import MigrationChart from "./MigrationChart";
import RenderTreeFigure from "./RenderTreeFigure";
import RetirementFigure from "./RetirementFigure";
import Stage, { StageHead } from "./Stage";
import UsageFigure from "./UsageFigure";
import shared from "./shared.module.css";
import styles from "./Stages.module.css";

function Adoption(): React.ReactElement {
  return (
    <Stage id="adoption" word="Adoption" variant="band">
      <div className={shared.col}>
        <StageHead id="adoption" title="Chart the adoption of any component" />
        <p className={clsx(shared.body, styles.lead)}>
          Any mix of libraries, packages or components, across all your repos or just one, scan by scan.
        </p>
        <ChartBuilder />
      </div>
    </Stage>
  );
}

function Usage(): React.ReactElement {
  return (
    <Stage id="usage" word="Usage">
      <div className={shared.col}>
        <StageHead id="usage" title="See which props and values teams actually pass" />
        <p className={clsx(shared.body, styles.lead)}>
          Every use, with the values it passes, linked to its line of code.
        </p>
        <UsageFigure />
      </div>
    </Stage>
  );
}

function Impact(): React.ReactElement {
  return (
    <Stage id="impact" word="Impact" joined>
      <div className={styles.impactRow}>
        <div className={styles.impactText}>
          <StageHead id="impact" title="See everything that depends on a component" />
          <p className={clsx(shared.body, styles.lead)}>
            Every component that renders it, directly or further up, so you know which screens a change will
            reach.
          </p>
        </div>
        <div className={styles.impactFigure}>
          <RenderTreeFigure />
        </div>
      </div>
    </Stage>
  );
}

function Migration(): React.ReactElement {
  return (
    <Stage id="migration" word="Migration">
      <div className={shared.col}>
        <StageHead id="migration" title="Mark what's replacing what, and watch the move" />
        <p className={clsx(shared.body, styles.lead)}>
          Mark a whole package or a single component as replaced, and every scan shows how much has moved to
          its replacement.
        </p>
        <MigrationChart />
      </div>
    </Stage>
  );
}

function Retirement(): React.ReactElement {
  return (
    <Stage id="retirement" word="Retirement" joined>
      <div className={shared.col}>
        <StageHead id="retirement" title="See who still uses what you're retiring" />
        <p className={clsx(shared.body, styles.lead)}>
          Retired components show the uses that remain, and where.
        </p>
        <RetirementFigure />
      </div>
    </Stage>
  );
}

/** The capability stages, in the order a component lives through them. */
export default function Stages(): React.ReactElement {
  return (
    <>
      <Adoption />
      <Usage />
      <Impact />
      <Migration />
      <Retirement />
    </>
  );
}
