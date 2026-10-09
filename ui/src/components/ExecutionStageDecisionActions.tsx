import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import type { IssueExecutionStageType } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type StageDecision = "approve" | "request_changes";

interface ExecutionStageDecisionActionsProps {
  issueId: string;
  companyId: string;
  /** Only shapes the wording; `null` reads as the neutral "review". */
  stageType: IssueExecutionStageType | null;
  /** Rendered at the left of the action row — e.g. a decisions-row disclosure toggle. */
  footerSlot?: ReactNode;
  /** Fired after a decision lands so the surface can navigate / close / refetch extras. */
  onResolved?: (decision: StageDecision) => void;
  className?: string;
}

/**
 * The status each decision asks for. `request_changes` must send `in_progress`:
 * the board-override branch runs first for every status except `in_review` and
 * `in_progress`, and it drops the execution state without recording the
 * decision or returning the issue to its assignee. So `todo` from a board
 * participant dissolves the stage rather than sending the work back.
 */
const DECISION_STATUS: Record<StageDecision, "done" | "in_progress"> = {
  approve: "done",
  request_changes: "in_progress",
};

const DECISION_PAST_TENSE: Record<StageDecision, string> = {
  approve: "Approved — the issue moves on.",
  request_changes: "Changes requested — issue returned to the assignee.",
};

/**
 * The two verdicts the current participant of a *pending* execution stage can
 * give: approve it, or send the work back. Shared by the issue page and the
 * /decisions card so both surfaces decide the same way, through the one PATCH
 * that runs the execution-policy transition: `{ status, comment }` together.
 *
 * Both verdicts require a comment, because the server requires one for each and
 * only reads the comment sent in the same request. Only the stage's own
 * participant sees these controls — see `executionStageDecisionTarget`.
 *
 * A *stalled* review is a different case with different semantics and keeps its
 * own control (`StalledReviewActions`).
 */
export function ExecutionStageDecisionActions({
  issueId,
  companyId,
  stageType,
  footerSlot,
  onResolved,
  className,
}: ExecutionStageDecisionActionsProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [comment, setComment] = useState("");

  const decide = useMutation({
    mutationFn: (decision: StageDecision) =>
      issuesApi.update(issueId, { status: DECISION_STATUS[decision], comment: comment.trim() }),
    onSuccess: (_result, decision) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.attention(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId) });
      setComment("");
      pushToast({ title: DECISION_PAST_TENSE[decision], tone: "success" });
      onResolved?.(decision);
    },
    onError: (error) => {
      pushToast({
        title: "Could not record the decision",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "error",
      });
    },
  });

  const pending = decide.isPending;
  const commentEmpty = comment.trim().length === 0;
  const runningFor = (decision: StageDecision) => pending && decide.variables === decision;
  const approveLabel = stageType === "approval" ? "Approve" : "Approve review";

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="execution-stage-decision">
      <Textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Add a comment — required for either decision…"
        className="min-h-16 text-sm"
        data-testid="execution-stage-decision-comment"
        disabled={pending}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {footerSlot ?? <span className="hidden sm:block" />}
        <div className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end @xl:flex-none">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-amber-400/70 text-amber-900 hover:bg-amber-100 dark:border-amber-500/50 dark:text-amber-100 dark:hover:bg-amber-500/15 sm:w-auto sm:flex-1 @xl:flex-none"
            disabled={pending || commentEmpty}
            title={commentEmpty ? "Add a comment to request changes" : undefined}
            onClick={() => decide.mutate("request_changes")}
            data-testid="execution-stage-decision-request-changes"
          >
            {runningFor("request_changes") ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            )}
            Request changes
          </Button>
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto sm:flex-1 @xl:flex-none"
            disabled={pending || commentEmpty}
            title={commentEmpty ? "Add a comment to approve" : undefined}
            onClick={() => decide.mutate("approve")}
            data-testid="execution-stage-decision-approve"
          >
            {runningFor("approve") ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {approveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
