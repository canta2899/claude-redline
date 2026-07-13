// A session is one document plus a flat list of feedback items:
//   "ask"    — a clarification thread. Only the user resolves it.
//   "change" — a single request, removed outright once addressed.
// An item with `quote` cites a document span; without one it's global.

export type FeedbackKind = "ask" | "change";
export type Author = "user" | "agent";

export interface Comment {
  author: Author;
  content: string;
  at: string; // ISO8601
  rev: number;
}

export interface Feedback {
  id: string;
  kind: FeedbackKind;
  /** Absent means the item is about the whole document, not a cited span. */
  quote?: string;
  /** Asks only — change requests are removed instead of resolved. */
  resolved?: boolean;
  comments: Comment[];
}

export type SessionStatus = "open" | "closed";

export interface SessionData {
  created_at: string; // ISO8601
  status: SessionStatus;
  /** Bumped on every mutation and stamped onto comments. */
  rev: number;
  /** Backs feedback ids ("f1", "f2", …). Never reused, even after removal. */
  seq: number;
  /** The `rev` up to which feedback has been handed to the Agent (see `pull`). */
  pulled_rev: number;
  document: string;
  feedback: Feedback[];
}

export type ClientMessage =
  | { type: "add"; kind: FeedbackKind; quote?: string; content: string }
  | { type: "reply"; id: string; content: string }
  | { type: "edit"; id: string; index: number; content: string }
  | { type: "delete"; id: string }
  | { type: "resolve"; id: string }
  | { type: "reopen"; id: string }
  | { type: "end" };

export type ServerMessage =
  | { type: "state"; session: SessionData }
  | { type: "error"; message: string };

export interface Reply {
  to: string;
  content: string;
}

export interface PushInput {
  replies?: Reply[];
  addressed?: string[];
}

export interface PulledItem {
  id: string;
  kind: FeedbackKind;
  quote?: string;
  comments: { author: Author; content: string }[];
}

export interface PullResult {
  status: SessionStatus;
  turn: number;
  feedback: PulledItem[];
  /** Present once the review is over — nothing more to do. */
  message?: string;
}

export interface AgentEvent extends PullResult {
  type: "review-requested";
}
