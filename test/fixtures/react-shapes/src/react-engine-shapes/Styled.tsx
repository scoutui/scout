// `styled(NS.Button)`, an import-backed argument reached
// through a member expression. The render isn't credited yet: the scan reports
// `unresolved-reference` for `StyledButton`, pinned as `it.fails` in
// react-shapes.test.ts. `styled-components` is deliberately not installed.
import styled from "styled-components";
import * as NS from "@example/react-ds";

const StyledButton = styled(NS.Button)`
  color: red;
`;

export function Styled() {
  return <StyledButton />;
}
