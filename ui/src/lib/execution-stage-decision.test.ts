import { describe, expect, it } from "vitest";
import type { IssueExecutionState } from "@paperclipai/shared";
import {
  executionStageDecisionTarget,
  readExecutionStageDecisionMetadata,
} from "./execution-stage-decision";

function executionState(overrides: Partial<IssueExecutionState> = {}): IssueExecutionState {
  return {
    status: "pending",
    currentStageId: "stage-1",
    currentStageIndex: 0,
    currentStageType: "review",
    currentParticipant: { type: "user", userId: "user-1" },
    returnAssignee: { type: "agent", agentId: "agent-1" },
    reviewRequest: null,
    completedStageIds: [],
    lastDecisionId: null,
    lastDecisionOutcome: null,
    ...overrides,
  };
}

describe("executionStageDecisionTarget", () => {
  it("returns the stage for the user who owns it", () => {
    expect(executionStageDecisionTarget(executionState(), "user-1")).toEqual({
      stageType: "review",
      participantUserId: "user-1",
    });
  });

  it("carries the approval stage type through", () => {
    expect(executionStageDecisionTarget(executionState({ currentStageType: "approval" }), "user-1"))
      .toEqual({ stageType: "approval", participantUserId: "user-1" });
  });

  it("gives nothing to a different user, or to no user at all", () => {
    expect(executionStageDecisionTarget(executionState(), "user-2")).toBeNull();
    expect(executionStageDecisionTarget(executionState(), null)).toBeNull();
    expect(executionStageDecisionTarget(executionState(), undefined)).toBeNull();
  });

  it("gives nothing for an agent participant", () => {
    // The agent answers for itself through its own run, so no viewer inherits
    // the verdict — not even a board user watching the issue.
    const state = executionState({ currentParticipant: { type: "agent", agentId: "agent-2" } });
    expect(executionStageDecisionTarget(state, "user-1")).toBeNull();
  });

  it("gives nothing once the stage is no longer pending", () => {
    for (const status of ["idle", "changes_requested", "completed"] as IssueExecutionState["status"][]) {
      expect(executionStageDecisionTarget(executionState({ status }), "user-1")).toBeNull();
    }
  });

  it("gives nothing without an execution state, or without a participant", () => {
    expect(executionStageDecisionTarget(null, "user-1")).toBeNull();
    expect(executionStageDecisionTarget(undefined, "user-1")).toBeNull();
    expect(executionStageDecisionTarget(executionState({ currentParticipant: null }), "user-1")).toBeNull();
  });

  it("gives nothing for a user participant with no id to match", () => {
    const state = executionState({ currentParticipant: { type: "user", userId: null } });
    expect(executionStageDecisionTarget(state, "user-1")).toBeNull();
  });

  it("reads an unknown stage type as no stage type, not as a refusal", () => {
    // Forward compatibility: a stage type this build does not know still belongs
    // to its participant, and only the wording goes neutral.
    const state = executionState({
      currentStageType: "triage" as unknown as IssueExecutionState["currentStageType"],
    });
    expect(executionStageDecisionTarget(state, "user-1")).toEqual({
      stageType: null,
      participantUserId: "user-1",
    });
  });
});

describe("readExecutionStageDecisionMetadata", () => {
  it("reads the participant and stage type off a feed row", () => {
    expect(readExecutionStageDecisionMetadata(
      { executionParticipantUserId: "user-1", executionStageType: "approval" },
      "user-1",
    )).toEqual({ stageType: "approval", participantUserId: "user-1" });
  });

  it("gives nothing to another viewer", () => {
    const metadata = { executionParticipantUserId: "user-1", executionStageType: "review" };
    expect(readExecutionStageDecisionMetadata(metadata, "user-2")).toBeNull();
    expect(readExecutionStageDecisionMetadata(metadata, null)).toBeNull();
  });

  it("gives nothing for a row without the metadata", () => {
    // A stalled review row, a row from an older build, or no metadata at all.
    expect(readExecutionStageDecisionMetadata({ reviewAttentionState: "stalled" }, "user-1")).toBeNull();
    expect(readExecutionStageDecisionMetadata({}, "user-1")).toBeNull();
    expect(readExecutionStageDecisionMetadata(null, "user-1")).toBeNull();
    expect(readExecutionStageDecisionMetadata(undefined, "user-1")).toBeNull();
  });

  it("ignores a participant id that is not a non-empty string", () => {
    expect(readExecutionStageDecisionMetadata({ executionParticipantUserId: "" }, "user-1")).toBeNull();
    expect(readExecutionStageDecisionMetadata({ executionParticipantUserId: 7 }, "user-1")).toBeNull();
  });

  it("falls back to no stage type when the row does not name a known one", () => {
    expect(readExecutionStageDecisionMetadata(
      { executionParticipantUserId: "user-1", executionStageType: null },
      "user-1",
    )).toEqual({ stageType: null, participantUserId: "user-1" });
  });
});
