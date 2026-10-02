import FakeButton from "@example/shoelace/dist/react/button/index.js";
import FakeInput from "@example/shoelace/dist/react/input/index.js";
import FakeCard from "@example/shoelace/dist/react/card/index.js";

export function App() {
  return (
    <FakeCard>
      <FakeInput label="Name" />
      <FakeButton variant="primary" size="medium">
        Save
      </FakeButton>
      <FakeButton variant="default">Cancel</FakeButton>
    </FakeCard>
  );
}
