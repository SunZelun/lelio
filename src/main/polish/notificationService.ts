import { Notification } from "electron";
import type { ApprovalRecord, NotificationTestResult, SessionStatus } from "../../shared/schemas";
import type { JsonlLogger } from "../logging/logger";

export class NotificationService {
  constructor(private readonly logger: JsonlLogger) {}

  sendTest(correlationId: string): NotificationTestResult {
    return this.showGeneric({
      title: "Lelio notifications are enabled",
      body: "Session and approval alerts use private summaries only.",
      correlationId,
      eventName: "notification.test"
    });
  }

  notifyApprovalPending(approval: ApprovalRecord): void {
    this.showGeneric({
      title: "Lelio needs a decision",
      body: approval.taskId ? "A task session is waiting on an approval." : "A session is waiting on an approval.",
      correlationId: approval.id,
      eventName: "notification.approval_pending"
    });
  }

  notifySessionTerminal(input: { sessionId: string; status: SessionStatus; taskTitle?: string | null }): void {
    if (!["completed", "failed", "aborted"].includes(input.status)) {
      return;
    }
    const statusLabel = input.status === "completed" ? "completed" : input.status === "failed" ? "failed" : "stopped";
    this.showGeneric({
      title: `Lelio session ${statusLabel}`,
      body: input.taskTitle ? "A task session changed status." : "A coding session changed status.",
      correlationId: input.sessionId,
      eventName: "notification.session_terminal"
    });
  }

  private showGeneric(input: { title: string; body: string; correlationId: string; eventName: string }): NotificationTestResult {
    if (!Notification.isSupported()) {
      this.logger.warn({
        source: "notification",
        eventName: input.eventName,
        message: "Notification skipped because system notifications are unsupported",
        correlationId: input.correlationId
      });
      return { requested: true, shown: false, reason: "System notifications are not supported in this environment." };
    }

    const notification = new Notification({
      title: input.title,
      body: input.body,
      silent: false
    });
    notification.show();
    this.logger.info({
      source: "notification",
      eventName: input.eventName,
      message: "Notification shown",
      correlationId: input.correlationId
    });
    return { requested: true, shown: true, reason: null };
  }
}
