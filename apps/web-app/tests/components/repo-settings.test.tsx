// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({ createToken: vi.fn(), regenerateToken: vi.fn(), revokeToken: vi.fn(), deleteRepo: vi.fn() }));
vi.mock("@/app/repos/repo-actions", () => actions);

import { DeleteRepoSection, UploadTokenSection } from "@/components/repos/repo-settings";

const REPO = "payloadcms/payload";
const TOKEN = "scout_r_q7Lm2vT9wXc4RbN8pKd3YhF6uZa1GgVt5oWsEj0Dx1y";
const CREATED = { when: "3 days ago", at: "2026-10-11 09:12 UTC", by: "ana@example.com" };
const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("UploadTokenSection", () => {
  it("creates a token and shows it once, with Copy, until Done", async () => {
    actions.createToken.mockResolvedValue({ ok: true, token: TOKEN });
    const { rerender } = render(<UploadTokenSection repoId={REPO} created={null} />);
    expect(screen.getByText("No token")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    const copy = await screen.findByRole("button", { name: "Copy" });
    expect(actions.createToken).toHaveBeenCalledExactlyOnceWith(REPO);
    expect(screen.getByText(TOKEN)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(copy));
    expect(screen.getByText(/^Save it as/).textContent).toBe("Save it as SCOUTUI_TOKEN in this repo's CI. You won't see it again.");

    rerender(<UploadTokenSection repoId={REPO} created={{ ...CREATED, when: "just now" }} />);
    expect(screen.getByText(TOKEN)).toBeInTheDocument();
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(TOKEN));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(TOKEN)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Regenerate" }));
  });

  it.each([
    { clipboard: "blocked", stub: () => writeText.mockRejectedValue(new Error("Write permission denied.")) },
    { clipboard: "missing", stub: () => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }) },
  ])("says when the token couldn't be copied after a copy that worked, with the clipboard $clipboard", async ({ stub }) => {
    actions.createToken.mockResolvedValue({ ok: true, token: TOKEN });
    render(<UploadTokenSection repoId={REPO} created={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    const copied = await screen.findByRole("button", { name: "Copied" });
    stub();
    fireEvent.click(copied);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the token. Select it and copy it instead.");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("asks before regenerating in the token's row, and shows the new token once confirmed", async () => {
    actions.regenerateToken.mockResolvedValue({ ok: true, token: TOKEN });
    render(<UploadTokenSection repoId={REPO} created={CREATED} />);
    expect(screen.getByText(/^Created/).textContent).toBe("Created 3 days ago by ana@example.com");
    expect(screen.getByText("3 days ago")).toHaveAttribute("title", "2026-10-11 09:12 UTC");

    const regenerate = screen.getByRole("button", { name: "Regenerate" });
    fireEvent.click(regenerate);
    expect(screen.getByText("Regenerate the token? The current one stops working at once.")).toBeInTheDocument();
    expect(document.activeElement).toBe(regenerate);
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();

    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.click(cancel);
    expect(screen.getByText(/^Created/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(document.activeElement).toBe(regenerate);
    expect(actions.regenerateToken).not.toHaveBeenCalled();

    fireEvent.click(regenerate);
    fireEvent.click(regenerate);
    await waitFor(() => expect(actions.regenerateToken).toHaveBeenCalledExactlyOnceWith(REPO));
    expect(await screen.findByText(TOKEN)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Copy" })));
  });

  it("says only when the token was created when its creator has no email", () => {
    render(<UploadTokenSection repoId={REPO} created={{ ...CREATED, by: null }} />);
    expect(screen.getByText(/^Created/).textContent).toBe("Created 3 days ago");
    expect(screen.getByText("3 days ago")).toHaveAttribute("title", "2026-10-11 09:12 UTC");
  });

  it("asks before revoking in the token's row, then moves focus to Create token", async () => {
    actions.revokeToken.mockResolvedValue({ ok: true });
    const { rerender } = render(<UploadTokenSection repoId={REPO} created={CREATED} />);
    const revoke = screen.getByRole("button", { name: "Revoke" });
    fireEvent.click(revoke);
    expect(screen.getByText("Revoke the token? CI can't upload scans of this repo until someone creates a new one.")).toBeInTheDocument();
    expect(document.activeElement).toBe(revoke);
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();

    fireEvent.click(revoke);
    await waitFor(() => expect(actions.revokeToken).toHaveBeenCalledExactlyOnceWith(REPO));
    await screen.findByRole("button", { name: "Regenerate" });
    rerender(<UploadTokenSection repoId={REPO} created={null} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create token" }));
  });

  it("shows why a change was refused, and no token", async () => {
    actions.regenerateToken.mockResolvedValue({ ok: false, error: "Only Editors can make changes. Ask an Admin for access." });
    render(<UploadTokenSection repoId={REPO} created={CREATED} />);
    const regenerate = screen.getByRole("button", { name: "Regenerate" });
    fireEvent.click(regenerate);
    fireEvent.click(regenerate);

    expect(await screen.findByRole("alert")).toHaveTextContent("Only Editors can make changes. Ask an Admin for access.");
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });
});

describe("DeleteRepoSection", () => {
  it.each([
    { scanCount: 5, hasToken: true, sentence: "Deletes the repo, its 5 scans and its CI upload token." },
    { scanCount: 5, hasToken: false, sentence: "Deletes the repo and its 5 scans." },
    { scanCount: 1, hasToken: false, sentence: "Deletes the repo and its 1 scan." },
  ])("says $sentence", ({ scanCount, hasToken, sentence }) => {
    render(<DeleteRepoSection repoId={REPO} scanCount={scanCount} hasToken={hasToken} />);
    expect(screen.getByText(/^Deletes the repo/).textContent).toBe(sentence);
  });
});
