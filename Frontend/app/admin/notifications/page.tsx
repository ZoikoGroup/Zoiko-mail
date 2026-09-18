"use client";

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/lib/admin-hooks";
import type { NotificationDto } from "@/lib/admin-api";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  type Tone,
} from "@/components/admin/ui";

const SEVERITY: Record<NotificationDto["severity"], { label: string; tone: Tone }> = {
  CRITICAL: { label: "Critical", tone: "crit" },
  ACTION_REQUIRED: { label: "Action", tone: "warn" },
  WARNING: { label: "Warning", tone: "warn" },
  INFO: { label: "Info", tone: "ok" },
};

export default function AdminNotificationsPage() {
  const { data: notifications, isLoading, error } = useNotifications();

  // Read state belongs to the server. It used to live in a local Set, so
  // clearing an alert lasted until the next refresh and the rail badge never
  // moved — the screen looked like it worked and changed nothing.
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unreadIds = (notifications ?? []).filter((n) => !n.readAt).map((n) => n.id);
  const unread = unreadIds.length;
  const busy = markRead.isPending || markAll.isPending;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Operational alerts for this workspace"
        action={
          unread > 0 ? (
            <button
              type="button"
              className="zoiko-btn sm"
              disabled={busy}
              onClick={() => markAll.mutate(unreadIds)}
            >
              {markAll.isPending ? "Marking…" : "Mark all read"}
            </button>
          ) : undefined
        }
      />

      {/* A partial failure is reported rather than swallowed: the list refetches
          either way, so the rows themselves already show what actually landed. */}
      {markAll.error ? <Notice tone="warn">{markAll.error.message}</Notice> : null}
      {markRead.error ? (
        <Notice tone="warn">Could not mark that notification read. {markRead.error.message}</Notice>
      ) : null}

      <Card
        title="Recent"
        badge={unread > 0 ? <Pill tone="warn">{`${unread} unread`}</Pill> : <Pill tone="ok">All read</Pill>}
      >
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !notifications ? (
          <LoadingRows rows={4} />
        ) : notifications.length === 0 ? (
          <InlineEmpty title="Nothing to report" hint="Operational alerts will appear here." />
        ) : (
          notifications.map((notification) => {
            const severity = SEVERITY[notification.severity];
            const isRead = Boolean(notification.readAt);
            const marking = markRead.isPending && markRead.variables === notification.id;
            return (
              <Row
                key={notification.id}
                title={
                  <span className={isRead ? "font-normal text-[var(--ink2)]" : undefined}>
                    {notification.title}
                  </span>
                }
                detail={notification.body}
                right={
                  <>
                    <Pill tone={severity.tone}>{severity.label}</Pill>
                    <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
                      {notification.ago}
                    </span>
                    {!isRead && (
                      <button
                        type="button"
                        className="zoiko-btn sm"
                        disabled={busy}
                        onClick={() => markRead.mutate(notification.id)}
                      >
                        {marking ? "Marking…" : "Mark read"}
                      </button>
                    )}
                  </>
                }
              />
            );
          })
        )}
      </Card>
    </>
  );
}
