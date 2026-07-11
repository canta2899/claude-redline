import { useMemo, useRef, useState } from "react";
import { useSession } from "./session";
import { useAnchoredThreads } from "./anchors";
import { Composer } from "./components/Composer";
import { Document } from "./components/Document";
import { Card } from "./components/Card";

export function App() {
  const { session, conn, addFeedback, reply, editComment, remove, resolve, reopen, end } = useSession();

  const feedback = session?.feedback ?? [];
  const openItems = useMemo(() => feedback.filter((f) => !(f.kind === "ask" && f.resolved)), [feedback]);
  const resolvedItems = useMemo(() => feedback.filter((f) => f.kind === "ask" && f.resolved), [feedback]);
  const sessionOpen = session?.status === "open";
  const document = session?.document ?? "";

  const pageRef = useRef<HTMLElement>(null);
  const marginRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { placement, registerCard, orphaned } = useAnchoredThreads(pageRef, marginRef, openItems, activeId, document);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">redline</span>
        </div>
        <span className={"conn conn-" + conn}>
          <span className="conn-dot" aria-hidden="true" />
          {connLabel(conn, session?.status ?? "open")}
        </span>
        {(openItems.length > 0 || resolvedItems.length > 0) && (
          <span className="thread-count">
            {openItems.length} open{resolvedItems.length > 0 ? ` · ${resolvedItems.length} resolved` : ""}
          </span>
        )}
        <div className="topbar-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={!sessionOpen}
            onClick={() => {
              if (confirm("End this review? This tells the Agent the document is fully resolved.")) end();
            }}
          >
            End review
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className="doc-wrap">
          <Document
            document={document}
            sessionOpen={sessionOpen}
            pageRef={pageRef}
            onAddFeedback={(kind, content, quote) => addFeedback(kind, content, quote)}
          />
          {sessionOpen && (
            <div className="general-composer">
              <div className="general-composer-label">Comment on the document as a whole</div>
              <Composer
                placeholder="A note on the whole document — ask about it, or request a change…"
                actions={[
                  { label: "Request change", variant: "primary", onSubmit: (c) => addFeedback("change", c) },
                  { label: "Ask", variant: "outline", onSubmit: (c) => addFeedback("ask", c) },
                ]}
              />
            </div>
          )}
        </div>

        <aside className="margin" ref={marginRef}>
          {openItems.length === 0 && resolvedItems.length === 0 && sessionOpen && (
            <p className="margin-hint">
              Highlight any text to <strong>ask a question</strong> or <strong>request a change</strong> — or drop a
              general note under the document.
            </p>
          )}

          <div className="thread-layer" style={{ height: placement.layerHeight }}>
            {openItems.map((item) => (
              <div
                key={item.id}
                ref={registerCard(item.id)}
                className={"thread-anchor" + (activeId === item.id ? " is-active" : "")}
                style={{ transform: `translateY(${placement.tops[item.id] ?? 0}px)` }}
                onMouseEnter={() => setActiveId(item.id)}
                onMouseLeave={() => setActiveId((cur) => (cur === item.id ? null : cur))}
              >
                <Card
                  item={item}
                  sessionOpen={sessionOpen}
                  orphaned={orphaned.has(item.id)}
                  onReply={(content) => reply(item.id, content)}
                  onEdit={(index, content) => editComment(item.id, index, content)}
                  onDelete={() => remove(item.id)}
                  onResolve={() => resolve(item.id)}
                  onReopen={() => reopen(item.id)}
                />
              </div>
            ))}
          </div>

          {resolvedItems.length > 0 && (
            <div className="resolved-section">
              <div className="margin-divider">Resolved</div>
              {resolvedItems.map((item) => (
                <Card
                  key={item.id}
                  item={item}
                  sessionOpen={sessionOpen}
                  onReply={(content) => reply(item.id, content)}
                  onEdit={(index, content) => editComment(item.id, index, content)}
                  onDelete={() => remove(item.id)}
                  onResolve={() => resolve(item.id)}
                  onReopen={() => reopen(item.id)}
                />
              ))}
            </div>
          )}
        </aside>
      </div>

      {!sessionOpen && session && <div className="closed-banner">This review is closed.</div>}
    </div>
  );
}

function connLabel(conn: string, status: string): string {
  if (status === "closed") return "closed";
  if (conn === "connected") return "live";
  if (conn === "connecting") return "connecting…";
  return conn;
}
