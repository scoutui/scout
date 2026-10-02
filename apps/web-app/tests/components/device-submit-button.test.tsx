// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const status = { pending: false };
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => status,
}));

import { DeviceSubmitButton } from "@/app/login/device/submit-button";

beforeEach(() => {
  status.pending = false;
});

describe("DeviceSubmitButton", () => {
  it("disables a pending approval and announces its progress", () => {
    status.pending = true;
    render(<DeviceSubmitButton intent="approve" />);
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
  });

  it("keeps each choice enabled while idle", () => {
    render(<DeviceSubmitButton intent="deny" />);
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
  });
});
