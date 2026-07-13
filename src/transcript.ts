import type { SessionData } from "./types.ts";

export function renderTranscript(state: SessionData): string {
  const lines: string[] = ["# Review transcript", ""];
  lines.push(
    `_${state.feedback.length} item${
      state.feedback.length === 1 ? "" : "s"
    } · ${state.status}_`,
    "",
  );

  if (state.feedback.length === 0) {
    lines.push("No feedback was left.", "");
    return lines.join("\n");
  }

  for (const f of state.feedback) {
    const kind = f.kind === "ask" ? "Question" : "Change request";
    const status = f.kind === "ask"
      ? (f.resolved ? "resolved" : "open")
      : "pending";
    lines.push(`## ${f.id} · ${kind} (${status})`, "");
    if (f.quote) {
      lines.push(...f.quote.trim().split("\n").map((l) => `> ${l}`), "");
    }
    for (const c of f.comments) {
      const who = c.author === "user" ? "**Reviewer:**" : "**Agent:**";
      lines.push(`${who} ${c.content.trim()}`, "");
    }
  }

  return lines.join("\n");
}
