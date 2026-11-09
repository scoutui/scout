import { fireEvent, screen } from "@testing-library/react";

/** Opens a Select and picks the option named `name`. A mouse click picks only a highlighted option, so it hovers the option first. */
export function pickOption(trigger: HTMLElement, name: string) {
  fireEvent.click(trigger);
  const option = screen.getByRole("option", { name });
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}
