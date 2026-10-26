"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Copy,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  CalendarDays,
  FileText,
  Paperclip,
  Upload,
  X,
} from "lucide-react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ApiError } from "@/lib/api-client";
import { useMe } from "@/lib/auth-hooks";
import {
  useAskAssistant,
  useAssistantConversation,
  useAssistantConversations,
  useDeleteAssistantConversation,
  useRenameAssistantConversation,
} from "@/lib/assistant-hooks";
import {
  ASSISTANT_FILE_ACCEPT,
  ASSISTANT_MAX_FILES,
  ASSISTANT_MAX_QUESTION_CHARS,
  assistantFileProblem,
  removeAssistantUpload,
  uploadAssistantFile,
  type AssistantAttachment,
  type AssistantConversationSummary,
  type AssistantMessage,
} from "@/lib/assistant-api";
import { newIdempotencyKey } from "@/lib/api-client";
import { FilePreview, type PreviewItem } from "@/components/mail/AttachmentPreview";
import { ComposerFileChips, MessageFiles, composerPreviewItem, sentImagePreviewItem, type ComposerFile } from "./AssistantFiles";
import { avatarInitials, hashColor } from "@/components/mail/MailRow";
import { AssistantMarkdown } from "./AssistantMarkdown";

const SUGGESTIONS = [
  { icon: Mail, title: "Draft an email", prompt: "Draft a polite email to a client reminding them that their invoice is 10 days overdue." },
  { icon: FileText, title: "Summarise text", prompt: "Summarise the following text in three bullet points:\n\n" },
  { icon: PenLine, title: "Improve my writing", prompt: "Make this message clearer and more professional:\n\n" },
  { icon: Paperclip, title: "Ask about a file", prompt: "", attach: true },
  { icon: CalendarDays, title: "Plan my week", prompt: "Help me plan a focused work week with time for deep work, meetings and email." },
];

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (Array.isArray(error.details) && error.details[0]?.message) return error.details[0].message;
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

const dayFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? timeFormat.format(d) : dayFormat.format(d);
}

/** A question waiting for its answer, or one whose answer failed. Its files go with it on a retry. */
type Pending = { content: string; conversationId: string | null; attachments: AssistantAttachment[]; error: string | null };

export function AssistantPage() {
  const params = useSearchParams();
  const router = useRouter();
  const conversationId = params.get("c");
  const { data: me } = useMe();
  const conversations = useAssistantConversations();
  const conversation = useAssistantConversation(conversationId);
  const ask = useAskAssistant();
  const rename = useRenameAssistantConversation();
  const remove = useDeleteAssistantConversation();

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [renaming, setRenaming] = useState<AssistantConversationSummary | null>(null);
  const [deleting, setDeleting] = useState<AssistantConversationSummary | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const messages: AssistantMessage[] = useMemo(
    () => (conversationId ? conversation.data?.messages ?? [] : []),
    [conversationId, conversation.data]
  );
  // Only the pending question for the conversation on screen is shown.
  const shownPending = pending && pending.conversationId === conversationId ? pending : null;
  const title = conversationId ? conversation.data?.title ?? "Conversation" : "New chat";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, shownPending?.content, shownPending?.error]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  // The composer grows with what is typed, up to a limit.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const open = (id: string | null) => {
    setListOpen(false);
    router.push(id ? `/mail/alet?c=${id}` : "/mail/alet");
  };

  const patchFile = (key: string, patch: Partial<ComposerFile>) =>
    setFiles((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const uploadFile = (entry: ComposerFile) => {
    uploadAssistantFile(entry.file, entry.idempotencyKey).then(
      (attachment) => patchFile(entry.key, { status: "ready", attachment, error: undefined }),
      (error) => patchFile(entry.key, { status: "error", error: errorText(error) })
    );
  };

  /** Files picked, dropped or pasted: checked here first, then read by the server at once. */
  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    const room = ASSISTANT_MAX_FILES - files.length;
    if (room <= 0) {
      setNotice(`You can attach up to ${ASSISTANT_MAX_FILES} files to one question.`);
      return;
    }
    if (incoming.length > room) setNotice(`Only ${room} more file${room === 1 ? "" : "s"} can be attached to this question.`);
    const entries: ComposerFile[] = incoming.slice(0, room).map((file) => {
      const problem = assistantFileProblem(file);
      return {
        key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        status: problem ? "error" : "uploading",
        error: problem ?? undefined,
        idempotencyKey: newIdempotencyKey(),
      };
    });
    setFiles((current) => [...current, ...entries]);
    entries.filter((e) => e.status === "uploading").forEach(uploadFile);
  };

  const removeFile = (key: string) => {
    const entry = files.find((f) => f.key === key);
    setFiles((current) => current.filter((f) => f.key !== key));
    // An uploaded file never sent is removed from the server too.
    if (entry?.attachment) void removeAssistantUpload(entry.attachment.id).catch(() => undefined);
  };

  const send = (content: string, inConversation: string | null, attachments: AssistantAttachment[]) => {
    const question = content.trim();
    if ((!question && attachments.length === 0) || ask.isPending) return;
    setPending({ content: question, conversationId: inConversation, attachments, error: null });
    setDraft("");
    setFiles([]);
    ask.mutate(
      { content: question, conversationId: inConversation ?? undefined, attachmentIds: attachments.map((a) => a.id) },
      {
        onSuccess: (reply) => {
          setPending(null);
          if (!inConversation) router.replace(`/mail/alet?c=${reply.conversation.id}`);
        },
        onError: (error) => setPending({ content: question, conversationId: inConversation, attachments, error: errorText(error) }),
      }
    );
  };

  const readyFiles = files.filter((f) => f.status === "ready").map((f) => f.attachment!);
  const uploading = files.some((f) => f.status === "uploading");
  const refused = files.some((f) => f.status === "error");
  const tooLong = draft.length > ASSISTANT_MAX_QUESTION_CHARS;
  const canSend =
    (Boolean(draft.trim()) || readyFiles.length > 0) && !uploading && !refused && !tooLong && !ask.isPending && !shownPending?.error;
  const submit = () => {
    if (canSend) send(draft, conversationId, readyFiles);
  };
  const missing = conversationId && conversation.isError;
  const loadingThread = conversationId && conversation.isLoading;
  const firstName = me?.displayName?.split(/\s+/)[0];

  const list = (
    <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-testid="assistant-conversations">
      <h2 className="px-3 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Recent chats</h2>
      {conversations.isLoading ? (
        <p className="px-3 py-1 text-xs text-[var(--ink3)]" role="status">Loading…</p>
      ) : conversations.isError ? (
        <p className="px-3 py-1 text-xs text-[var(--crit)]">
          Couldn&rsquo;t load your chats.{" "}
          <button type="button" className="underline" onClick={() => conversations.refetch()}>Retry</button>
        </p>
      ) : (conversations.data ?? []).length === 0 ? (
        <p className="px-3 py-1 text-xs text-[var(--ink3)]">No chats yet. Your conversations are saved here.</p>
      ) : (
        <ul className="space-y-0.5">
          {conversations.data!.map((c) => {
            const current = c.id === conversationId;
            return (
              <li key={c.id} className={`group flex items-center rounded-lg pr-1 ${current ? "bg-[var(--zm-selected)]" : "hover:bg-[var(--s2)]"}`}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  aria-current={current ? "page" : undefined}
                  className={`relative flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    current ? "font-semibold text-[var(--ink)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--accent)]" : "text-[var(--ink2)]"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[11px] font-normal text-[var(--ink3)]">{when(c.updatedAt)}</span>
                </button>
                <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <DropdownMenu trigger={<MoreHorizontal className="h-4 w-4" aria-label={`Options for ${c.title}`} />}>
                    <DropdownItem onClick={() => setRenaming(c)}>
                      <span className="flex items-center gap-2"><Pencil className="h-3.5 w-3.5" aria-hidden /> Rename</span>
                    </DropdownItem>
                    <DropdownItem danger onClick={() => setDeleting(c)}>
                      <span className="flex items-center gap-2"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</span>
                    </DropdownItem>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );

  const newChat = (
    <div className="p-3 pb-1">
      <button
        type="button"
        onClick={() => open(null)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-[14px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(47,111,237,0.7)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
      >
        <Plus className="h-4 w-4" aria-hidden /> New chat
      </button>
    </div>
  );

  return (
    <WebmailShell section="alet">
      <div className="flex h-full min-h-0">
        <aside aria-label="Alet" className="hidden h-full w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] lg:flex">
          {newChat}
          {list}
          <div className="m-3 flex gap-2 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3 text-[11.5px] leading-relaxed text-[var(--ink2)]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" aria-hidden />
            <p>Your chats are private to you. Alet can&rsquo;t see your mailbox, calendar or contacts.</p>
          </div>
        </aside>

        {/* Phone and tablet: the chat list as a panel. */}
        {listOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Chats">
            <div className="absolute inset-0 bg-black/50" onClick={() => setListOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[85vw] max-w-[320px] flex-col bg-[var(--surface)] shadow-[var(--sh3)]">
              {newChat}
              {list}
            </div>
          </div>
        )}

        <section aria-label="Chat with Alet" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 lg:px-6">
            <button type="button" onClick={() => setListOpen(true)} className="zoiko-btn lg:hidden" aria-label="Open chats">
              <MessageSquare className="h-4 w-4" aria-hidden /> Chats
            </button>
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-white sm:flex">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-semibold text-[var(--ink)]" data-testid="assistant-title">{title}</h1>
              <p className="truncate text-[12px] text-[var(--ink3)]">Alet AI assistant · answers are generated by AI and can be wrong</p>
            </div>
            {conversationId && conversation.data && (
              <span className="hidden sm:block">
                <button type="button" className="zoiko-btn" onClick={() => open(null)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> New chat
                </button>
              </span>
            )}
          </header>

          {notice && (
            <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-[var(--ok)]/40 bg-[var(--ok-soft)] px-3 py-2 text-[12.5px] text-[var(--ok)] lg:mx-6">
              <Check className="h-4 w-4" aria-hidden /> <span className="flex-1">{notice}</span>
            </div>
          )}

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-testid="assistant-thread">
            <div className="mx-auto w-full max-w-[860px] px-4 py-6 lg:px-6">
              {missing ? (
                <div role="alert" className="mx-auto mt-10 max-w-md text-center">
                  <AlertTriangle className="mx-auto h-8 w-8 text-[var(--crit)]" aria-hidden />
                  <p className="mt-3 text-[14px] font-semibold text-[var(--ink)]">This chat isn&rsquo;t available.</p>
                  <p className="mt-1 text-[12.5px] text-[var(--ink3)]">{errorText(conversation.error)}</p>
                  <button type="button" className="zoiko-btn pri mt-4" onClick={() => open(null)}>Start a new chat</button>
                </div>
              ) : loadingThread ? (
                <div className="space-y-4" role="status" aria-label="Loading conversation">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`h-16 animate-pulse rounded-2xl bg-[var(--s2)] ${i % 2 ? "ml-auto w-2/3" : "w-3/4"}`} />
                  ))}
                </div>
              ) : messages.length === 0 && !shownPending ? (
                <Welcome
                  name={firstName}
                  onPick={(prompt, attach) => {
                    if (attach) picker.current?.click();
                    else {
                      setDraft(prompt);
                      input.current?.focus();
                    }
                  }}
                />
              ) : (
                <ol className="space-y-5" aria-label="Messages">
                  {messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      myName={me?.displayName ?? me?.email ?? "You"}
                      onCopied={() => setNotice("Answer copied.")}
                      onOpenImage={(a) => {
                        const images = m.attachments.filter((x) => x.kind === "IMAGE");
                        setPreview({ items: images.map(sentImagePreviewItem), index: Math.max(0, images.findIndex((x) => x.id === a.id)) });
                      }}
                    />
                  ))}
                  {shownPending && (
                    <>
                      <MessageRow
                        message={{ id: "pending", role: "USER", content: shownPending.content, createdAt: new Date().toISOString(), attachments: shownPending.attachments }}
                        myName={me?.displayName ?? me?.email ?? "You"}
                        onCopied={() => undefined}
                        onOpenImage={() => undefined}
                      />
                      {shownPending.error ? (
                        <li className="ml-11" data-testid="assistant-error">
                          <div role="alert" className="flex flex-wrap items-start gap-2 rounded-xl border border-[var(--crit)]/40 bg-[var(--crit-soft)] px-4 py-3 text-[13px] text-[var(--crit)]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1">{shownPending.error}</span>
                            <span className="flex gap-2">
                              <button type="button" className="zoiko-btn" onClick={() => send(shownPending.content, shownPending.conversationId, shownPending.attachments)}>
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
                              </button>
                              <button
                                type="button"
                                className="zoiko-btn"
                                onClick={() => {
                                  setDraft(shownPending.content);
                                  // The files go back to the composer, still uploaded and ready.
                                  setFiles(
                                    shownPending.attachments.map((a) => ({
                                      key: a.id,
                                      file: new File([], a.fileName, { type: a.contentType }),
                                      status: "ready" as const,
                                      attachment: a,
                                      idempotencyKey: newIdempotencyKey(),
                                    }))
                                  );
                                  setPending(null);
                                  input.current?.focus();
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                              </button>
                              <button type="button" className="zoiko-btn" aria-label="Dismiss" onClick={() => setPending(null)}>
                                <X className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </span>
                          </div>
                        </li>
                      ) : (
                        <li className="flex items-start gap-3" data-testid="assistant-thinking" role="status" aria-label="Alet is thinking">
                          <AletAvatar />
                          <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                            {[0, 1, 2].map((i) => (
                              <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-[var(--ink3)]" style={{ animationDelay: `${i * 150}ms` }} />
                            ))}
                            <span className="ml-2 text-[12.5px] text-[var(--ink3)]">
                              {shownPending.attachments.length
                                ? `Alet is reading ${shownPending.attachments.length === 1 ? "your file" : `${shownPending.attachments.length} files`}…`
                                : "Alet is thinking…"}
                            </span>
                          </div>
                        </li>
                      )}
                    </>
                  )}
                </ol>
              )}
            </div>
          </div>

          <form
            className="relative border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-4 pt-3 lg:px-6"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes("Files")) {
                e.preventDefault();
                setDragging(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            {dragging && (
              <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)] text-[13px] font-medium text-[var(--accent-ink)]">
                <Upload className="mr-2 h-4 w-4" aria-hidden /> Drop PDF, Word or image files to attach
              </div>
            )}
            <input
              ref={picker}
              type="file"
              multiple
              accept={ASSISTANT_FILE_ACCEPT}
              className="sr-only"
              data-testid="assistant-file-input"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="mx-auto w-full max-w-[860px]">
              <ComposerFileChips
                files={files}
                onOpen={(index) => setPreview({ items: files.map(composerPreviewItem), index })}
                onRemove={removeFile}
              />
              <div className={`flex items-end gap-2 rounded-2xl border bg-[var(--ground)] p-2 transition focus-within:border-[var(--accent)] ${tooLong ? "border-[var(--crit)]" : "border-[var(--border)]"}`}>
                <button
                  type="button"
                  onClick={() => picker.current?.click()}
                  disabled={Boolean(missing) || files.length >= ASSISTANT_MAX_FILES}
                  aria-label="Attach files"
                  title="Attach PDF, Word or image files (up to 4, 10 MB each)"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--ink2)] transition hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Paperclip className="h-5 w-5" aria-hidden />
                </button>
                <label htmlFor="assistant-input" className="sr-only">Ask Alet</label>
                <textarea
                  id="assistant-input"
                  ref={input}
                  rows={1}
                  value={draft}
                  disabled={Boolean(missing)}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  onPaste={(e) => {
                    // A pasted screenshot is attached like a picked image.
                    const pasted = Array.from(e.clipboardData.files);
                    if (pasted.length) {
                      e.preventDefault();
                      addFiles(pasted);
                    }
                  }}
                  placeholder={
                    ask.isPending
                      ? "Alet is answering…"
                      : files.length
                        ? "Ask about the attached files, or send to get a summary…"
                        : "Ask Alet anything — or attach a PDF, Word file or image…"
                  }
                  className="max-h-[200px] min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[14px] leading-relaxed text-[var(--ink)] shadow-none !outline-none placeholder:text-[var(--ink3)] focus:ring-0"
                  aria-invalid={tooLong}
                  aria-describedby="assistant-hint"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label="Send"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <p id="assistant-hint" className="mt-1.5 flex justify-between gap-3 text-[11px] text-[var(--ink3)]">
                <span>
                  {uploading
                    ? "Reading your files…"
                    : refused
                      ? "Remove the file that couldn't be attached to send."
                      : "Enter to send · Shift+Enter for a new line · Attach PDF, Word or images · Alet can make mistakes."}
                </span>
                {draft.length > ASSISTANT_MAX_QUESTION_CHARS * 0.8 && (
                  <span className={tooLong ? "font-semibold text-[var(--crit)]" : ""}>
                    {draft.length.toLocaleString()}/{ASSISTANT_MAX_QUESTION_CHARS.toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          </form>
        </section>
      </div>

      {preview && <FilePreview items={preview.items} startIndex={preview.index} onClose={() => setPreview(null)} />}
      {renaming && (
        <RenameDialog
          conversation={renaming}
          busy={rename.isPending}
          error={rename.error ? errorText(rename.error) : null}
          onClose={() => { setRenaming(null); rename.reset(); }}
          onSave={(newTitle) =>
            rename.mutate({ id: renaming.id, title: newTitle }, { onSuccess: () => { setRenaming(null); setNotice("Chat renamed."); } })
          }
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this chat?"
        message={`“${deleting?.title ?? ""}” and all its messages are deleted. This cannot be undone.`}
        confirmLabel="Delete chat"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const target = deleting;
          remove.mutate(target.id, {
            onSuccess: () => {
              setNotice("Chat deleted.");
              if (target.id === conversationId) open(null);
            },
            onError: (e) => setNotice(`Couldn’t delete the chat: ${errorText(e)}`),
            onSettled: () => setDeleting(null),
          });
        }}
      />
    </WebmailShell>
  );
}

function AletAvatar() {
  return (
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-white" aria-hidden>
      <Sparkles className="h-4 w-4" />
    </span>
  );
}

function MessageRow({
  message,
  myName,
  onCopied,
  onOpenImage,
}: {
  message: AssistantMessage;
  myName: string;
  onCopied: () => void;
  onOpenImage: (a: AssistantAttachment) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (message.role === "USER") {
    return (
      <li className="flex items-start justify-end gap-3" data-testid="assistant-question">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-[var(--accent)] px-4 py-2.5 text-[14px] leading-relaxed text-white [overflow-wrap:anywhere]">
          <MessageFiles attachments={message.attachments ?? []} onOpenImage={onOpenImage} />
          {message.content}
        </div>
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{ backgroundColor: hashColor(myName) }}
          aria-hidden
        >
          {avatarInitials(myName)}
        </span>
      </li>
    );
  }
  return (
    <li className="group flex items-start gap-3" data-testid="assistant-answer">
      <AletAvatar />
      <div className="min-w-0 max-w-[92%] flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <AssistantMarkdown text={message.content} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--ink3)]">
          <span>Alet · {when(message.createdAt)}</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message.content);
                setCopied(true);
                onCopied();
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // Clipboard refused; the answer can still be selected.
              }
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 opacity-70 transition hover:bg-[var(--s2)] hover:opacity-100 focus:opacity-100"
            aria-label="Copy answer"
          >
            {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </li>
  );
}

function Welcome({ name, onPick }: { name?: string; onPick: (prompt: string, attach?: boolean) => void }) {
  return (
    <div className="mx-auto mt-4 max-w-2xl text-center sm:mt-10" data-testid="assistant-welcome">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-white shadow-[0_10px_30px_-10px_rgba(47,111,237,0.8)]">
        <Sparkles className="h-7 w-7" aria-hidden />
      </span>
      <h2 className="mt-4 text-[22px] font-semibold text-[var(--ink)]">{name ? `Hi ${name}, how can I help?` : "How can I help?"}</h2>
      <p className="mt-1.5 text-[13.5px] text-[var(--ink2)]">
        Ask Alet to draft and polish emails, read and answer questions about files you attach, or plan your work.
      </p>
      <div className="mt-6 grid gap-2.5 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.title}
              type="button"
              onClick={() => onPick(s.prompt, "attach" in s && s.attach)}
              className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left transition hover:border-[var(--accent)]/50 hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-[var(--ink)]">{s.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-[12px] text-[var(--ink3)]">
                  {"attach" in s && s.attach ? "Attach a PDF, Word document or image and ask questions about it." : s.prompt.trim()}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RenameDialog({
  conversation,
  busy,
  error,
  onClose,
  onSave,
}: {
  conversation: AssistantConversationSummary;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(conversation.title);
  const problem = !value.trim() ? "Give it a name." : value.trim().length > 120 ? "Keep it to 120 characters." : null;
  const save = () => {
    if (!problem && !busy) onSave(value.trim());
  };
  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="Rename chat"
      size="sm"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="zoiko-btn pri" onClick={save} disabled={busy || Boolean(problem)}>{busy ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label htmlFor="chat-title" className="mb-1 block text-[12px] font-medium text-[var(--ink2)]">Name</label>
        <input id="chat-title" className="zoiko-input" value={value} autoFocus onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(problem)} />
        {problem && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problem}</p>}
        {error && <p role="alert" className="mt-2 text-[12px] text-[var(--crit)]">{error}</p>}
      </form>
    </Modal>
  );
}
