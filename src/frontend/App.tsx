import { useMemo, useRef, useState } from "react";
import { useSession } from "./session";
import { useAnchoredThreads } from "./anchors";
import { Composer } from "./components/Composer";
import { Document } from "./components/Document";
import { Card } from "./components/Card";
import { CloseIcon, PencilIcon } from "./components/icons";

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
  const [noteOpen, setNoteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

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
        <div className="topbar-actions">
          {resolvedItems.length > 0 && (
            <button type="button" className="resolved-toggle" onClick={() => setHistoryOpen(true)}>
              Resolved <span className="count">{resolvedItems.length}</span>
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={!sessionOpen} onClick={() => setEndOpen(true)}>
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
        </div>

        <aside className="margin" ref={marginRef}>
          <div className="margin-head">
            Comments <span className="count">{openItems.length}</span>
          </div>

          {openItems.length === 0 && sessionOpen && (
            <p className="margin-hint">
              Highlight any text to <strong>ask a question</strong> or <strong>request a change</strong>. To comment on
              the document as a whole, use <strong>Comment on document</strong>.
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
        </aside>
      </div>

      {/* A note on the whole document is a rare, deliberate action — kept out of
          the way behind a floating button rather than a panel below the page. */}
      {sessionOpen && (
        <>
          <button
            type="button"
            className={"fab" + (noteOpen ? " is-open" : "")}
            onClick={() => setNoteOpen((v) => !v)}
          >
            <PencilIcon size={17} /> Comment on document
          </button>
          {noteOpen && (
            <>
              <div className="pop-scrim" onClick={() => setNoteOpen(false)} />
              <div className="doc-note">
                <div className="doc-note-head">
                  <span className="doc-note-title">On the whole document</span>
                  <button type="button" className="icon-btn" title="Close" onClick={() => setNoteOpen(false)}>
                    <CloseIcon size={15} />
                  </button>
                </div>
                <p className="doc-note-sub">A note that isn't tied to a specific passage.</p>
                <Composer
                  autoFocus
                  placeholder="Ask about the document, or request a rewrite…"
                  actions={[
                    {
                      label: "Request change",
                      variant: "primary",
                      onSubmit: (c) => {
                        addFeedback("change", c);
                        setNoteOpen(false);
                      },
                    },
                    {
                      label: "Ask",
                      variant: "outline",
                      onSubmit: (c) => {
                        addFeedback("ask", c);
                        setNoteOpen(false);
                      },
                    },
                  ]}
                  onCancel={() => setNoteOpen(false)}
                />
              </div>
            </>
          )}
        </>
      )}

      {historyOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setHistoryOpen(false)} />
          <aside className="drawer" role="dialog" aria-label="Resolved threads">
            <div className="drawer-head">
              <span className="drawer-title">
                Resolved<span className="count">{resolvedItems.length}</span>
              </span>
              <button type="button" className="icon-btn" title="Close" onClick={() => setHistoryOpen(false)}>
                <CloseIcon size={17} />
              </button>
            </div>
            <div className="drawer-body">
              {resolvedItems.length === 0 ? (
                <p className="drawer-empty">No resolved threads yet.</p>
              ) : (
                resolvedItems.map((item) => (
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
                ))
              )}
            </div>
          </aside>
        </>
      )}

      {endOpen && (
        <div className="modal-scrim" onClick={() => setEndOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="End review" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">End this review?</div>
            <p className="modal-body">
              This tells the Agent the document is fully resolved. Any open comments stop here and no further feedback
              can be added.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setEndOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  end();
                  setEndOpen(false);
                }}
              >
                End review
              </button>
            </div>
          </div>
        </div>
      )}

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
