import type { IssueExecutionStageType, IssueExecutionState } from "@paperclipai/shared";

/**
 * A pending execution stage the viewing user owns, and may therefore decide.
 * Built either from an issue payload (`executionStageDecisionTarget`) or from an
 * attention review row's metadata (`readExecutionStageDecisionMetadata`), so the
 * issue page and the /decisions card agree on who sees the controls.
 */
export interface ExecutionStageDecisionTarget {
  /** `null` when the row predates the metadata, which only softens the wording. */
  stageType: IssueExecutionStageType | null;
  participantUserId: string;
}

function target(
  stageType: unknown,
  participantUserId: string,
): ExecutionStageDecisionTarget {
  return {
    stageType: stageType === "review" || stageType === "approval" ? stageType : null,
    participantUserId,
  };
}

/**
 * The stage the viewer may decide, from a full issue payload — or `null`.
 *
 * Null for every case that is not the viewer's own decision: no stage, a stage
 * already decided, an *agent* participant (the agent answers for itself), and a
 * user participant who is somebody else. The last one matters: the server marks
 * the row resolvable because the item carries a decision, not because the
 * reader holds it, so the viewer check lives here.
 */
export function executionStageDecisionTarget(
  executionState: IssueExecutionState | null | undefined,
  currentUserId: string | null | undefined,
): ExecutionStageDecisionTarget | null {
  if (!executionState || executionState.status !== "pending") return null;
  const participant = executionState.currentParticipant;
  if (!participant || participant.type !== "user") return null;
  const participantUserId = participant.userId;
  if (!participantUserId || !currentUserId || participantUserId !== currentUserId) return null;
  return target(executionState.currentStageType, participantUserId);
}

/**
 * The same decision, read off an untyped `AttentionSubject.metadata` bag. The
 * feed row carries only the participant and the stage type, which is all the
 * controls need.
 */
export function readExecutionStageDecisionMetadata(
  metadata: Record<string, unknown> | null | undefined,
  currentUserId: string | null | undefined,
): ExecutionStageDecisionTarget | null {
  const participantUserId = metadata?.executionParticipantUserId;
  if (typeof participantUserId !== "string" || !participantUserId) return null;
  if (!currentUserId || participantUserId !== currentUserId) return null;
  return target(metadata?.executionStageType, participantUserId);
}
