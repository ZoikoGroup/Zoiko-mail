"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/**
 * The assistant answers in Markdown. This renders the part of it answers use
 * (paragraphs, headings, lists, quotes, code, bold, italic, inline code and
 * links) as React elements. Nothing is ever set as HTML, so an answer cannot
 * inject markup or script; links open only for http(s) and mailto.
 */

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[]; start: number }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "hr" };

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence (or end of answer)
      blocks.push({ kind: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/;
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const start = ordered ? Number(line.match(numbered)![1]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const m = current.match(pattern);
        if (m) {
          items.push(ordered ? m[2]! : m[1]!);
          i++;
        } else if (current.trim() && /^\s{2,}/.test(current) && items.length) {
          // A wrapped line belongs to the item above.
          items[items.length - 1] += ` ${current.trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: ordered ? "ol" : "ul", items, start });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^\s*```/.test(lines[i]!) &&
      !/^#{1,4}\s/.test(lines[i]!) &&
      !/^\s*>/.test(lines[i]!) &&
      !bullet.test(lines[i]!) &&
      !numbered.test(lines[i]!)
    ) {
      body.push(lines[i++]!);
    }
    blocks.push({ kind: "p", text: body.join("\n") });
  }
  return blocks;
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Bold, italic, inline code and links within one block of text. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let n = 0;
  for (const match of Array.from(text.matchAll(pattern))) {
    const at = match.index ?? 0;
    if (at > last) out.push(...withBreaks(text.slice(last, at), `${keyPrefix}-t${n}`));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;
    if (match[1]) {
      out.push(
        <code key={key} className="rounded bg-[var(--s2)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--ink)]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      out.push(<strong key={key} className="font-semibold text-[var(--ink)]">{inline(token.slice(2, -2), key)}</strong>);
    } else if (match[3]) {
      out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      out.push(
        SAFE_LINK.test(link[2]!) ? (
          <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-2">
            {link[1]}
          </a>
        ) : (
          <span key={key}>{link[1]}</span>
        )
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(...withBreaks(text.slice(last), `${keyPrefix}-end`));
  return out;
}

function withBreaks(text: string, key: string): ReactNode[] {
  return text.split("\n").map((part, i) => (
    <Fragment key={`${key}-${i}`}>
      {i > 0 && <br />}
      {part}
    </Fragment>
  ));
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--s2)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1 text-[11px] text-[var(--ink3)]">
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Clipboard refused; the code can still be selected.
            }
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--surface)] hover:text-[var(--ink)]"
        >
          {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed text-[var(--ink)]">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-[var(--ink)] [overflow-wrap:anywhere]">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case "h": {
            const size = block.level <= 2 ? "text-[16px]" : "text-[14.5px]";
            return <p key={key} className={`${size} font-semibold text-[var(--ink)]`}>{inline(block.text, key)}</p>;
          }
          case "ul":
            return (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => <li key={j}>{inline(item, `${key}-${j}`)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} start={block.start} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, j) => <li key={j}>{inline(item, `${key}-${j}`)}</li>)}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-[var(--border)] pl-3 text-[var(--ink2)]">
                {inline(block.text, key)}
              </blockquote>
            );
          case "code":
            return <CodeBlock key={key} lang={block.lang} text={block.text} />;
          case "hr":
            return <hr key={key} className="border-[var(--border)]" />;
          default:
            return <p key={key}>{inline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
