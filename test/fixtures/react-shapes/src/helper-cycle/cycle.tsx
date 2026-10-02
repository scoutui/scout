const Leaf = () => <span>leaf</span>;

// Two helpers that call each other, one rendering `<Leaf/>`: the owner walk
// from that render loops helperA → helperB → helperA, and the cycle guard in
// resolveOwnerChain stops it, so the render is reported with no owner.
const helperA = (): JSX.Element[] => [<Leaf />, ...helperB()];
const helperB = (): JSX.Element[] => helperA();

// View renders Leaf directly. The mutual-recursion cycle elsewhere in
// the file should NOT affect View's normal attribution.
export const View = () => <div><Leaf /></div>;
