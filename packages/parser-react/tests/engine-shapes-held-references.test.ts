/**
 * A component the code plainly uses is a registry member, on real parser
 * output, including one held as an object-literal property value or passed
 * as a call argument inside a nested scope.
 *
 * Every case asserts `noOrphanOwners`: an occurrence's local owner names a
 * component the registry contains.
 */
import { describe, it, expect } from "vitest";
import { scanGraph, relResolver } from "./shape-helpers.js";

type Resolved = ReturnType<typeof scanGraph>;

const memberNames = (g: Resolved) => g.registry.localEntries().map((e) => e.exportName).sort();

/** Local component identities the occurrences resolved to. */
const renderedNames = (g: Resolved) =>
  g.occurrences
    .map((o) => o.rawComponentId)
    .flatMap((id) => (id?.kind === "react-component" && id.source.type === "local" ? [id.export] : []))
    .sort();

/** Local owners stamped on occurrences that the registry does not contain. */
const orphanOwners = (g: Resolved) =>
  g.occurrences
    .map((o) => o.rawOwnerComponentId)
    .flatMap((owner) =>
      owner?.kind === "react-component" && owner.source.type === "local" && !g.registry.hasLocal(owner.source.filePath, owner.export)
        ? [owner.export]
        : [],
    );

describe("held references are consumption", () => {
  it("a component held as an object-literal property value is a member", () => {
    const g = scanGraph(
      {
        "src/AttendeeStatusIcon.tsx": `
          import { IcCheckmarkCircleFilled, IcCrossCircleFilled } from "@example/design-system";
          const IconYes = () => (<span className="color-success"><IcCheckmarkCircleFilled size={3} /></span>);
          const IconNo = () => (<span className="color-danger"><IcCrossCircleFilled size={3} /></span>);
          export const iconMap = { ACCEPTED: IconYes, DECLINED: IconNo };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["IconNo", "IconYes"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a component held under a computed key is a member", () => {
    const g = scanGraph(
      {
        "src/AttendeeStatusIcon.tsx": `
          import { STATUS } from "./status";
          import { IcCheckmarkCircleFilled, IcCrossCircleFilled } from "@example/design-system";
          const IconYes = () => (<span><IcCheckmarkCircleFilled /></span>);
          const IconNo = () => (<span><IcCrossCircleFilled /></span>);
          export const iconMap = { [STATUS.ACCEPTED]: IconYes, [STATUS.DECLINED]: IconNo };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["IconNo", "IconYes"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a dynamic access into a computed-key map renders the held components", () => {
    const g = scanGraph(
      {
        "src/AttendeeStatusIcon.tsx": `
          import { STATUS } from "./status";
          const IconYes = () => <b />;
          const IconNo = () => <i />;
          const iconMap = { [STATUS.ACCEPTED]: IconYes, [STATUS.DECLINED]: IconNo };
          export const AttendeeStatusIcon = ({ status }) => { const Icon = iconMap[status]; return <Icon />; };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(renderedNames(g)).toEqual(["IconNo", "IconYes"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a component passed to a call inside a hook body is a member", () => {
    const g = scanGraph(
      {
        "src/RenameModal.tsx": `
          import { useModalHolder } from "./modal";
          import { Button } from "@example/design-system";
          const OldRenameModal = ({ onClose }) => (<div><Button onClick={onClose} /></div>);
          export const useOldRenameModal = () => {
            const [renameModal, showRenameModal] = useModalHolder(OldRenameModal);
            return [renameModal, showRenameModal];
          };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toContain("OldRenameModal");
    expect(orphanOwners(g)).toEqual([]);
  });

  it("parity: a holder rendered only through its static member stays a member", () => {
    const g = scanGraph(
      {
        "src/Card.tsx": `
          import { Button } from "@example/design-system";
          const CardHeader = () => <Button />;
          function Card() { return <section />; }
          Card.Header = CardHeader;
          export const Page = () => <Card.Header />;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["Card", "CardHeader", "Page"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("an inert JSX-returning helper stays out of the registry", () => {
    const g = scanGraph(
      {
        "src/helpers.tsx": `
          import { Icon } from "@example/design-system";
          const renderIcon = () => <Icon />;
          export const label = "hello";
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual([]);
  });
});

/** The occurrence whose identity is the local component `name`, if any. */
const occurrenceOf = (g: Resolved, name: string) =>
  g.occurrences.find((o) => (o.rawComponentId as { export?: string }).export === name);

describe("an identifier in value position is a held reference", () => {
  it("JSX in a module-scope expression statement is an ownerless usage that consumes the component", () => {
    const g = scanGraph(
      {
        "src/index.tsx": `
          import { createRoot } from "react-dom/client";
          import { Button } from "@example/design-system";
          const App = () => <Button />;
          createRoot(document.getElementById("root")).render(<App />);
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toContain("App");
    expect(occurrenceOf(g, "App")?.rawOwnerComponentId ?? null).toBeNull();
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a component passed as a JSX attribute value or a JSX child expression is a member", () => {
    const g = scanGraph(
      {
        "src/ListView.tsx": `
          import { List, Button } from "@example/design-system";
          const Row = () => <Button />;
          const Body = () => <Button variant="ghost" />;
          export const ListView = () => <List rowAs={Row}>{Body}</List>;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["Body", "ListView", "Row"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a component attached by member assignment is a member", () => {
    const g = scanGraph(
      {
        "src/List.tsx": `
          import { Button } from "@example/design-system";
          const Item = () => <Button />;
          export const List = () => <ul />;
          List.Item = Item;
          List.displayName = "List";
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["Item", "List"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a component returned from a held callback is a member; a called lowercase helper is not", () => {
    const g = scanGraph(
      {
        "src/MeetingName.tsx": `
          import { Fragment, useMemo } from "react";
          import { Button, Icon } from "@example/design-system";
          const CTAContainer = ({ children }) => <Button>{children}</Button>;
          const renderIcon = () => <Icon />;
          export const MeetingName = ({ isHost }) => {
            const Wrapper = useMemo(() => (isHost ? CTAContainer : Fragment), [isHost]);
            return <Wrapper>{renderIcon()}</Wrapper>;
          };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["CTAContainer", "MeetingName"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a module-level destructured IIFE init is walked", () => {
    const g = scanGraph(
      {
        "src/iife.tsx": `
          import { Button } from "@example/design-system";
          const { Comp } = (() => {
            const Comp = () => <Button />;
            return { Comp };
          })();
          export const App = () => <Comp />;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toContain("Comp");
    expect(occurrenceOf(g, "Button")).toBeDefined();
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a component collected into an object-literal default export is a member", () => {
    const g = scanGraph(
      {
        "src/DocsLayout.tsx": `
          import { Button } from "@example/design-system";
          function Container({ children }) { return <Button>{children}</Button>; }
          function Grid({ children }) { return <div>{children}</div>; }
          export default { Container, Grid };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["Container", "Grid"]);
    expect(orphanOwners(g)).toEqual([]);
  });

  it("parity: a same-file component passed as a wrapper's second argument stays a member", () => {
    const g = scanGraph(
      {
        "src/Field.tsx": `
          import { forwardRef } from "react";
          import { Button } from "@example/design-system";
          const Other = () => <Button />;
          export default forwardRef((props, ref) => <div ref={ref} />, Other);
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toContain("Other");
    expect(orphanOwners(g)).toEqual([]);
  });
});
