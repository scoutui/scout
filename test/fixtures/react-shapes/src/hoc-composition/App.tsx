import { Button, TextInput, Card } from "@example/react-ds";

// Mock HOCs (self-contained — no external deps needed for the fixture).
const connect = <P,>() => (c: P) => c;
const withRouter = <P,>(c: P) => c;
const flow = (...fns: Array<(c: any) => any>) => (c: any) => fns.reduce((acc, fn) => fn(acc), c);
const compose = (...fns: Array<(c: any) => any>) => (c: any) => fns.reduceRight((acc, fn) => fn(acc), c);
const withA = (c: any) => c;
const withB = (c: any) => c;

// The HOC shapes, each wrapping a design-system component:
//   1. curried:  connect()(Button)
//   2. direct:   withRouter(TextInput)
//   3. flow:     flow(withA, withB)(Card), composed left to right
//   4. compose:  compose(withA, withB)(Button), composed right to left
//   5. nested:   withA(withB(TextInput))
const ConnectedButton = connect()(Button);
const WithRouterTextInput = withRouter(TextInput);
const FlowCard = flow(withA, withB)(Card);
const ComposeButton = compose(withA, withB)(Button);
const ChainedTextInput = withA(withB(TextInput));

export function App() {
  return (
    <>
      <ConnectedButton />
      <WithRouterTextInput />
      <FlowCard />
      <ComposeButton />
      <ChainedTextInput />
    </>
  );
}
