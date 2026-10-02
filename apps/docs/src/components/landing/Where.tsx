import type React from "react";
import Code from "./Code";
import shared from "./shared.module.css";

/** Which repo and component a figure shows, as the web app heads a component page: repo / name package. */
export default function Where({ repo, name, pkg }: { repo: string; name: string; pkg: string }): React.ReactElement {
  return (
    <p className={shared.where}>
      <Code className={shared.whereQuiet}>{repo}</Code>
      <span className={shared.whereSlash} aria-hidden="true">
        /
      </span>
      <Code className={shared.whereName}>{name}</Code>
      <Code className={shared.whereQuiet}>{pkg}</Code>
    </p>
  );
}
