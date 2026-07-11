import { EventEmitter } from "node:events";
import type {
  Comment,
  Feedback,
  FeedbackKind,
  PullResult,
  PulledItem,
  Reply,
  SessionData,
} from "./types.js";

export class SessionValidationError extends Error {}

/**
 * Owns one review's live state, in memory. The document itself is NOT the
 * source of truth here — it lives on disk and `setDocument` mirrors it in.
 * Feedback is memory-only and lost when the process exits.
 */
export class SessionManager extends EventEmitter {
  private data: SessionData;

  constructor(document: string) {
    super();
    this.data = {
      created_at: new Date().toISOString(),
      status: "open",
      rev: 0,
      seq: 0,
      pulled_rev: 0,
      document,
      feedback: [],
    };
  }

  getDocument(): string {
    return this.data.document;
  }

  getState(): SessionData {
    return structuredClone(this.data);
  }

  setDocument(content: string): void {
    if (content === this.data.document) return;
    this.data.document = content;
    this.bumpRev();
    this.emit("change");
  }

  addFeedback(kind: FeedbackKind, content: string, quote?: string): Feedback {
    this.assertOpen();
    const item: Feedback = {
      id: this.nextId(),
      kind,
      comments: [this.makeComment("user", content)],
    };
    if (quote !== undefined && quote.trim()) item.quote = quote;
    this.data.feedback.push(item);
    this.emit("change");
    return item;
  }

  reply(id: string, content: string, author: "user" | "agent" = "user"): Feedback {
    this.assertOpen();
    const item = this.getAsk(id);
    item.comments.push(this.makeComment(author, content));
    this.emit("change");
    return item;
  }

  editComment(id: string, index: number, content: string): Feedback {
    this.assertOpen();
    const item = this.getItem(id);
    const comment = item.comments[index];
    if (!comment) throw new SessionValidationError(`Comment ${index} not found on "${id}".`);
    if (comment.author !== "user") throw new SessionValidationError("Only your own comments can be edited.");
    comment.content = content;
    comment.rev = this.bumpRev();
    this.emit("change");
    return item;
  }

  deleteFeedback(id: string): void {
    this.assertOpen();
    this.getItem(id); // throws if unknown
    this.data.feedback = this.data.feedback.filter((f) => f.id !== id);
    this.emit("change");
  }

  resolve(id: string): Feedback {
    this.assertOpen();
    const item = this.getAsk(id);
    item.resolved = true;
    this.emit("change");
    return item;
  }

  reopen(id: string): Feedback {
    this.assertOpen();
    const item = this.getAsk(id);
    item.resolved = false;
    // Fresh rev on every comment so the whole thread re-surfaces on the next pull.
    for (const c of item.comments) c.rev = this.bumpRev();
    this.emit("change");
    return item;
  }

  end(): void {
    if (this.data.status === "closed") return;
    this.data.status = "closed";
    this.emit("change");
  }

  /** Validated in full before any mutation, so a bad id leaves state untouched. */
  applyPush(replies: Reply[] = [], addressed: string[] = []): void {
    this.assertOpen();
    for (const r of replies) this.getAsk(r.to);
    for (const id of addressed) this.getChange(id);

    for (const r of replies) this.getItem(r.to).comments.push(this.makeComment("agent", r.content));
    if (addressed.length) {
      const drop = new Set(addressed);
      this.data.feedback = this.data.feedback.filter((f) => !drop.has(f.id));
    }
    this.emit("change");
  }

  /** Comments new since the last pull, per open item. Advances the high-water mark. */
  pull(): PullResult {
    if (this.data.status === "closed") {
      return {
        status: "closed",
        turn: this.data.rev,
        feedback: [],
        message: "Review complete — the document is fully resolved.",
      };
    }

    const since = this.data.pulled_rev;
    const items: PulledItem[] = [];
    for (const f of this.data.feedback) {
      if (f.resolved) continue;
      // Never echo the Agent's own replies back as "feedback".
      const fresh = f.comments.filter((c) => c.rev > since && c.author === "user");
      if (fresh.length === 0) continue;
      const item: PulledItem = {
        id: f.id,
        kind: f.kind,
        comments: fresh.map((c) => ({ author: c.author, content: c.content })),
      };
      if (f.quote !== undefined) item.quote = f.quote;
      items.push(item);
    }

    this.data.pulled_rev = this.data.rev;
    return { status: "open", turn: this.data.rev, feedback: items };
  }

  private makeComment(author: "user" | "agent", content: string): Comment {
    return { author, content, at: new Date().toISOString(), rev: this.bumpRev() };
  }

  private getItem(id: string): Feedback {
    const item = this.data.feedback.find((f) => f.id === id);
    if (!item) throw new SessionValidationError(`Unknown feedback id: "${id}"`);
    return item;
  }

  private getAsk(id: string): Feedback {
    const item = this.getItem(id);
    if (item.kind !== "ask") throw new SessionValidationError(`Feedback "${id}" is a change request, not an ask thread.`);
    return item;
  }

  private getChange(id: string): Feedback {
    const item = this.getItem(id);
    if (item.kind !== "change") throw new SessionValidationError(`Feedback "${id}" is an ask thread, not a change request.`);
    return item;
  }

  private nextId(): string {
    this.data.seq += 1;
    return `f${this.data.seq}`;
  }

  private bumpRev(): number {
    this.data.rev += 1;
    return this.data.rev;
  }

  private assertOpen(): void {
    if (this.data.status !== "open") {
      throw new SessionValidationError("The review is closed.");
    }
  }
}
