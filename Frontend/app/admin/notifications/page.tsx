"use client";

import { useState } from "react";
import { useNotifications } from "@/lib/admin-hooks";
import type { NotificationDto } from "@/lib/admin-api";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  PageHeader,
  Pill,
  Row,
  StaticNote,
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

  // Local read state so the screen behaves before PATCH /notifications/:id/read.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const markRead = (id: string) => setReadIds((prev) => new Set(prev).add(id));

  const unread = notifications?.filter((n) => !n.readAt && !readIds.has(n.id)).length ?? 0;

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
              onClick={() => setReadIds(new Set(notifications?.map((n) => n.id) ?? []))}
            >
              Mark all read
            </button>
          ) : undefined
        }
      />

      <StaticNote>Backend is complete — GET /notifications and mark-read</StaticNote>

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
            const isRead = Boolean(notification.readAt) || readIds.has(notification.id);
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
                        onClick={() => markRead(notification.id)}
                      >
                        Mark read
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
