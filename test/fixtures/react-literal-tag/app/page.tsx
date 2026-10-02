import { Button } from "@example/react-ds";
import { SubmitButton } from "../components/submit-button.js";

export default function Page() {
  return (
    <main>
      <Button variant="outlined" color="primary">Pay</Button>
      <SubmitButton variant="secondary" />
      <web-button variant="primary">Hello</web-button>
    </main>
  );
}
