// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { issuesApi } from "../api/issues";
import { ToastProvider } from "../context/ToastContext";
import { ToastViewport } from "./ToastViewport";
import { ExecutionStageDecisionActions } from "./ExecutionStageDecisionActions";

vi.mock("../api/issues", () => ({
  issuesApi: { update: vi.fn(() => Promise.resolve({})) },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function act<T>(cb: () => T): T {
  let result: T | undefined;
  flushSync(() => {
    result = cb();
  });
  return result as T;
}

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  act(() =>
    root?.render(
      <ToastProvider>
        <QueryClientProvider client={client}>
          {element}
          <ToastViewport />
        </QueryClientProvider>
      </ToastProvider>,
    ),
  );
  return container;
}

function renderPanel(stageType: "review" | "approval" = "review") {
  return render(
    <ExecutionStageDecisionActions issueId="issue-1" companyId="c1" stageType={stageType} />,
  );
}

function setComment(el: HTMLElement, value: string) {
  const comment = el.querySelector<HTMLTextAreaElement>('[data-testid="execution-stage-decision-comment"]')!;
  act(() => {
    // React reads the value through its own descriptor, so a plain assignment
    // is invisible to it. Go through the native setter.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(comment, value);
    comment.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return comment;
}

const approveButton = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-testid="execution-stage-decision-approve"]')!;
const requestChangesButton = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-testid="execution-stage-decision-request-changes"]')!;

describe("ExecutionStageDecisionActions", () => {
  it("sends the approval and its comment in one request", async () => {
    const el = renderPanel();
    setComment(el, "  Looks right, shipping it.  ");
    act(() => approveButton(el).click());
    await act(async () => {});

    // One PATCH carrying both: the server completes the stage only when the
    // decision comment arrives with the status.
    expect(vi.mocked(issuesApi.update)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(issuesApi.update)).toHaveBeenCalledWith("issue-1", {
      status: "done",
      comment: "Looks right, shipping it.",
    });
  });

  it("returns the work with in_progress, never todo", async () => {
    const el = renderPanel();
    setComment(el, "Needs a test for the empty case.");
    act(() => requestChangesButton(el).click());
    await act(async () => {});

    // `todo` from a board actor takes the override branch, which drops the
    // execution state without recording the decision or returning the issue to
    // its assignee. `in_progress` is the only status that sends work back.
    expect(vi.mocked(issuesApi.update)).toHaveBeenCalledWith("issue-1", {
      status: "in_progress",
      comment: "Needs a test for the empty case.",
    });
  });

  it("holds both verdicts until a comment is written", () => {
    const el = renderPanel();
    expect(approveButton(el).disabled).toBe(true);
    expect(requestChangesButton(el).disabled).toBe(true);

    // Whitespace is not a comment — the server trims before it checks.
    setComment(el, "   ");
    expect(approveButton(el).disabled).toBe(true);
    expect(requestChangesButton(el).disabled).toBe(true);

    setComment(el, "Approved.");
    expect(approveButton(el).disabled).toBe(false);
    expect(requestChangesButton(el).disabled).toBe(false);
  });

  it("names the stage in the approve verb", () => {
    expect(renderPanel("approval").textContent).toContain("Approve");
    expect(renderPanel("approval").textContent).not.toContain("Approve review");
  });

  it("surfaces a refusal and keeps the comment for a second try", async () => {
    vi.mocked(issuesApi.update).mockRejectedValueOnce(
      new ApiError("Approving a review or approval stage requires a comment.", 422, null),
    );
    const el = renderPanel();
    const comment = setComment(el, "Ship it.");
    act(() => approveButton(el).click());
    // A rejection travels through the mutation before the toast mounts, so let
    // the task queue drain and flush the render it schedules.
    for (let i = 0; i < 20 && !document.body.textContent?.includes("Could not record"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      act(() => {});
    }

    expect(document.body.textContent).toContain("Could not record the decision");
    // The text stays put: a rejected decision must not cost the operator their
    // words.
    expect(comment.value).toBe("Ship it.");
  });
});
