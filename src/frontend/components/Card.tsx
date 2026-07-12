import { useState } from "react";
import type { Comment, Feedback } from "../../lib/types";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { ChatIcon, CheckIcon, FileIcon, PencilIcon, ReopenIcon, ReplyIcon, TrashIcon, WandIcon } from "./icons";

interface CardProps {
  item: Feedback;
  sessionOpen: boolean;
  /** The cited span is no longer in the document (edited away) — show it detached. */
  orphaned?: boolean;
  onReply: (content: string) => void;
  onEdit: (index: number, content: string) => void;
  onDelete: () => void;
  onResolve: () => void;
  onReopen: () => void;
}

export function Card({ item, sessionOpen, orphaned, onReply, onEdit, onDelete, onResolve, onReopen }: CardProps) {
  const [replying, setReplying] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  if (item.kind === "ask" && item.resolved) {
    return (
      <div className="thread thread-resolved">
        <div className="resolved-head">
          <CheckIcon size={14} />
          <span className="resolved-label">Resolved</span>
          {sessionOpen && (
            <button type="button" className="link-btn" onClick={onReopen}>
              <ReopenIcon size={13} /> Reopen
            </button>
          )}
        </div>
        {item.quote && <div className="thread-quote">{truncate(item.quote, 120)}</div>}
        <div className="resolved-summary">
          <Markdown>{item.comments[0]?.content ?? ""}</Markdown>
        </div>
      </div>
    );
  }

  const isAsk = item.kind === "ask";
  const lastComment = item.comments[item.comments.length - 1];
  const awaitingReply = isAsk && sessionOpen && !item.resolved && lastComment?.author === "user";

  return (
    <div className={"thread thread-" + item.kind}>
      <KindBadge kind={item.kind} />
      {item.quote ? (
        <div className={"thread-quote" + (orphaned ? " thread-quote-orphaned" : "")}>
          {truncate(item.quote, 160)}
          {orphaned && <span className="thread-quote-note"> · about a since-edited part</span>}
        </div>
      ) : (
        <div className="thread-scope">
          <FileIcon size={12} /> Whole document
        </div>
      )}

      <div className="thread-messages">
        {item.comments.map((comment, index) => (
          <Message
            key={index}
            comment={comment}
            sessionOpen={sessionOpen}
            editing={editingIndex === index}
            onStartEdit={() => setEditingIndex(index)}
            onCancelEdit={() => setEditingIndex(null)}
            onSaveEdit={(content) => {
              onEdit(index, content);
              setEditingIndex(null);
            }}
          />
        ))}
      </div>

      {awaitingReply && (
        <div className="awaiting-reply">
          <span className="spinner" aria-hidden="true" />
          Waiting for the Agent…
        </div>
      )}

      {item.kind === "change" && (
        <div className="pending-tag">
          <span className="spinner" aria-hidden="true" />
          Pending — the Agent removes this once it's addressed.
        </div>
      )}

      {sessionOpen && (
        <div className="thread-actions">
          {isAsk && !replying && (
            <button type="button" className="chip-btn" onClick={() => setReplying(true)}>
              <ReplyIcon size={14} /> Reply
            </button>
          )}
          {isAsk && (
            <button type="button" className="chip-btn chip-resolve" title="Mark this thread resolved" onClick={onResolve}>
              <CheckIcon size={14} /> Resolve
            </button>
          )}
          <button type="button" className="chip-btn" title="Delete this feedback" onClick={maybeDelete(onDelete)}>
            <TrashIcon size={14} /> Delete
          </button>
        </div>
      )}

      {isAsk && sessionOpen && replying && (
        <Composer
          autoFocus
          placeholder="Reply…"
          submitLabel="Reply"
          onSubmit={(content) => {
            onReply(content);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: "ask" | "change" }) {
  const isAsk = kind === "ask";
  return (
    <div className={"intent-tag " + (isAsk ? "intent-question" : "intent-change")}>
      {isAsk ? <ChatIcon size={12} /> : <WandIcon size={12} />}
      {isAsk ? "Question" : "Change request"}
    </div>
  );
}

interface MessageProps {
  comment: Comment;
  sessionOpen: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (content: string) => void;
}

function Message({ comment, sessionOpen, editing, onStartEdit, onCancelEdit, onSaveEdit }: MessageProps) {
  const isUser = comment.author === "user";

  if (editing) {
    return (
      <div className="comment comment-user editing">
        <Composer
          autoFocus
          initialValue={comment.content}
          placeholder="Edit your comment…"
          submitLabel="Save"
          onSubmit={onSaveEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div className={"comment comment-" + comment.author}>
      <div className="comment-head">
        <span className="comment-author">{isUser ? "You" : "Agent"}</span>
        {isUser && sessionOpen && (
          <div className="comment-tools">
            <button type="button" className="icon-btn" title="Edit" onClick={onStartEdit}>
              <PencilIcon size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="comment-body">
        <Markdown>{comment.content}</Markdown>
      </div>
    </div>
  );
}

function maybeDelete(onDelete: () => void) {
  return () => {
    if (confirm("Delete this feedback?")) onDelete();
  };
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}
