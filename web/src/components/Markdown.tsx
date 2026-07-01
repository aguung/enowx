import { Fragment, type ReactNode } from "react";
import { openProfileByName } from "../os/profileViewer";

// Markdown renders a Discord-flavored subset safely. Because it only ever emits
// known React elements (never dangerouslySetInnerHTML) and treats all text as
// literal, it is XSS-safe by construction. Supported:
//   **bold**  *italic* / _italic_  __underline__  ~~strike~~
//   `inline code`  ```code block```  > quote  - / * lists  1. lists
//   [label](https://url)  and bare https:// links  \n newlines
export function Markdown({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return <div className={className}>{renderBlocks(text)}</div>;
}

// renderBlocks splits into fenced code blocks vs normal line groups.
function renderBlocks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // Inside a code fence.
      out.push(
        <pre key={`code-${i}`} className="my-1 overflow-auto rounded-md bg-black/40 px-2 py-1.5 text-[12px] leading-relaxed">
          <code>{part.replace(/^\n/, "").replace(/\n$/, "")}</code>
        </pre>,
      );
    } else if (part) {
      out.push(<Fragment key={`t-${i}`}>{renderLines(part)}</Fragment>);
    }
  });
  return out;
}

// renderLines handles quotes, lists, and paragraphs line by line.
function renderLines(text: string): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: ReactNode[] | null = null;

  const flushList = (key: string) => {
    if (list) {
      out.push(
        <ul key={key} className="my-0.5 ml-4 list-disc space-y-0.5">
          {list}
        </ul>,
      );
      list = null;
    }
  };

  lines.forEach((line, i) => {
    const listMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      (list ??= []).push(<li key={`li-${i}`}>{renderInline(listMatch[1])}</li>);
      return;
    }
    flushList(`ul-${i}`);

    if (line.startsWith("> ")) {
      out.push(
        <blockquote key={`q-${i}`} className="my-0.5 border-l-2 border-white/25 pl-2 text-white/70">
          {renderInline(line.slice(2))}
        </blockquote>,
      );
      return;
    }
    if (line.trim() === "") {
      out.push(<br key={`br-${i}`} />);
      return;
    }
    out.push(
      <span key={`p-${i}`} className="block">
        {renderInline(line)}
      </span>,
    );
  });
  flushList("ul-end");
  return out;
}

// inlineRe matches the inline tokens (order matters: longer markers first).
// The @mention pattern mirrors the server's mention regex.
const inlineRe =
  /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s]+|@[A-Za-z0-9_.]{2,32})/g;

// renderInline parses bold/italic/underline/strike/code/links within a line.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  inlineRe.lastIndex = 0;
  let k = 0;
  while ((m = inlineRe.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `i-${k++}`;
    if (tok.startsWith("**") && tok.endsWith("**")) {
      nodes.push(<strong key={key}>{renderInline(tok.slice(2, -2))}</strong>);
    } else if (tok.startsWith("__") && tok.endsWith("__")) {
      nodes.push(<u key={key}>{renderInline(tok.slice(2, -2))}</u>);
    } else if (tok.startsWith("~~") && tok.endsWith("~~")) {
      nodes.push(<s key={key}>{renderInline(tok.slice(2, -2))}</s>);
    } else if ((tok.startsWith("*") && tok.endsWith("*")) || (tok.startsWith("_") && tok.endsWith("_"))) {
      nodes.push(<em key={key}>{renderInline(tok.slice(1, -1))}</em>);
    } else if (tok.startsWith("`") && tok.endsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-black/40 px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (lm) nodes.push(<SafeLink key={key} href={lm[2]}>{lm[1]}</SafeLink>);
      else nodes.push(tok);
    } else if (/^https?:\/\//.test(tok)) {
      nodes.push(<SafeLink key={key} href={tok}>{tok}</SafeLink>);
    } else if (tok.startsWith("@")) {
      const name = tok.slice(1);
      nodes.push(
        <button
          key={key}
          onClick={(e) => { e.stopPropagation(); openProfileByName(name); }}
          className="rounded bg-indigo-500/15 px-0.5 font-medium text-indigo-300 hover:bg-indigo-500/25"
        >
          {tok}
        </button>,
      );
    } else {
      nodes.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-indigo-300 hover:underline">
      {children}
    </a>
  );
}
