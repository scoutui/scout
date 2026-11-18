/**
 * Content between a component's tags is its `children` prop: `<Button>Save</Button>` passes `children` as
 * surely as `<Button children="Save" />` does. It is recorded as `dynamic`, since content is rarely one
 * literal worth listing as a value.
 */
import { describe, expect, it } from "vitest";
import { relResolver, scanGraph } from "./shape-helpers.js";

/** Each occurrence's props in `src/App.tsx`, in source order. */
function propsOf(body: string) {
  const { occurrences } = scanGraph(
    { "src/Button.tsx": "export const Button = (p: { children?: unknown; size?: string }) => null;", "src/App.tsx": `import { Button } from "./Button";\n${body}` },
    relResolver("/repo"),
    "/repo",
  );
  return occurrences.filter((o) => o.filePath === "src/App.tsx").map((o) => o.props);
}

const CHILDREN = { children: { tier: "dynamic" } };

describe("content as children", () => {
  it.each([
    ["text", "export const App = () => <Button>Save</Button>;"],
    ["an expression", "export const App = ({ label }: { label: string }) => <Button>{label}</Button>;"],
    ["an element", "export const App = () => <Button><span>Save</span></Button>;"],
    ["a fragment", "export const App = () => <Button><>Save</></Button>;"],
  ])("records children for %s between the tags", (_, body) => {
    expect(propsOf(body)).toEqual([CHILDREN]);
  });

  it.each([
    ["a self-closing tag", "export const App = () => <Button />;"],
    ["empty tags", "export const App = () => <Button></Button>;"],
    ["only whitespace and line breaks", "export const App = () => (\n  <Button>\n    \n  </Button>\n);"],
    ["only a comment", "export const App = () => <Button>{/* later */}</Button>;"],
  ])("records no children for %s", (_, body) => {
    expect(propsOf(body)).toEqual([{}]);
  });

  it("keeps a written children attribute and adds no second one", () => {
    expect(propsOf(`export const App = () => <Button children="Save">More</Button>;`)).toEqual([{ children: { tier: "written", value: "Save" } }]);
  });

  it("records children beside the attributes, and for each element of a nest", () => {
    expect(propsOf(`export const App = () => <Button size="sm"><Button>Inner</Button></Button>;`)).toEqual([{ size: { tier: "written", value: "sm" }, ...CHILDREN }, CHILDREN]);
  });
});
