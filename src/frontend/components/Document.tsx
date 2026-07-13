import { useEffect, useRef, useState } from "react";
import type { FeedbackKind } from "../../types.ts";
import { Composer } from "./Composer.tsx";
import { Markdown } from "./Markdown.tsx";
import { ChatIcon, WandIcon } from "./icons.tsx";

interface PendingSelection {
  quote: string;
  top: number;
  /** The page's right edge — the popup is docked there, not at the selection's x. */
  x: number;
}

interface DocumentProps {
  document: string;
  sessionOpen: boolean;
  pageRef: React.RefObject<HTMLElement | null>;
  onAddFeedback: (kind: FeedbackKind, content: string, quote: string) => void;
}

export function Document(
  { document: doc, sessionOpen, pageRef, onAddFeedback }: DocumentProps,
) {
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const clearSelection = () => {
    globalThis.getSelection()?.removeAllRanges();
    setSelection(null);
    setKind(null);
  };

  const onMouseUp = () => {
    if (!sessionOpen) return;
    const sel = globalThis.getSelection();
    const text = sel?.toString().trim();
    if (!sel || sel.isCollapsed || !text) return;

    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (!container || !pageRef.current?.contains(container)) return;

    const rect = range.getBoundingClientRect();
    const pageRight = pageRef.current.getBoundingClientRect().right;
    setSelection({ quote: text, top: rect.top, x: pageRight + 12 });
    setKind(null);
  };

  useEffect(() => {
    if (!selection) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(".sel-pill") || popupRef.current?.contains(t as Node)) {
        return;
      }
      clearSelection();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selection]);

  return (
    <div className="doc-col" onMouseUp={onMouseUp}>
      <article className="page" ref={pageRef}>
        <Markdown>{doc}</Markdown>
      </article>

      {selection && !kind && (
        <div
          className="sel-pill"
          style={{ top: selection.top, left: selection.x }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="sel-pill-btn"
            onClick={() => setKind("ask")}
          >
            <ChatIcon size={15} /> Ask
          </button>
          <span className="sel-pill-sep" aria-hidden="true" />
          <button
            type="button"
            className="sel-pill-btn"
            onClick={() => setKind("change")}
          >
            <WandIcon size={15} /> Request change
          </button>
        </div>
      )}

      {selection && kind && (
        <div
          ref={popupRef}
          className="selection-popup"
          style={{ top: selection.top, left: selection.x }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div
            className={"intent-tag " +
              (kind === "ask" ? "intent-question" : "intent-change")}
          >
            {kind === "ask" ? <ChatIcon size={12} /> : <WandIcon size={12} />}
            {kind === "ask" ? "Question" : "Change request"}
          </div>
          <div className="selection-quote">
            {truncate(selection.quote, 140)}
          </div>
          <Composer
            autoFocus
            placeholder={kind === "ask"
              ? "What would you like to ask?"
              : "What should change?"}
            submitLabel={kind === "ask" ? "Ask" : "Request change"}
            onSubmit={(content) => {
              onAddFeedback(kind, content, selection.quote);
              clearSelection();
            }}
            onCancel={clearSelection}
          />
        </div>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}
