import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { SessionManager, SessionValidationError } from "../src/session.ts";
import { renderTranscript } from "../src/transcript.ts";

Deno.test("a new session starts open and empty around the given document", () => {
  const manager = new SessionManager("the document text");
  const state = manager.getState();

  assertEquals(state.status, "open");
  assertEquals(state.rev, 0);
  assertEquals(state.seq, 0);
  assertEquals(state.pulled_rev, 0);
  assertEquals(state.document, "the document text");
  assertEquals(state.feedback, []);
});

Deno.test("setDocument() replaces the document and fires a change; a no-op does neither", () => {
  const manager = new SessionManager("original");
  let changes = 0;
  manager.on("change", () => (changes += 1));

  manager.setDocument("revised");
  assertEquals(manager.getDocument(), "revised");
  assertEquals(changes, 1);

  manager.setDocument("revised"); // identical — ignored
  assertEquals(changes, 1);
});

Deno.test("addFeedback() files asks and changes, inline (with quote) or global", () => {
  const manager = new SessionManager("some document text");

  const ask = manager.addFeedback(
    "ask",
    "what does this mean?",
    "document text",
  );
  assertEquals(ask.id, "f1");
  assertEquals(ask.kind, "ask");
  assertEquals(ask.quote, "document text");
  assertEquals(ask.comments.length, 1);
  assertEquals(
    { author: ask.comments[0]!.author, content: ask.comments[0]!.content },
    { author: "user", content: "what does this mean?" },
  );

  const change = manager.addFeedback("change", "make it shorter");
  assertEquals(change.id, "f2");
  assertEquals(change.kind, "change");
  assertEquals(change.quote, undefined); // global
});

Deno.test("reply() appends to an ask thread but refuses a change request", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.addFeedback("change", "fix"); // f2

  const item = manager.reply("f1", "a follow-up", "user");
  assertEquals(item.comments.length, 2);
  assertEquals(item.comments[1]!.author, "user");

  assertThrows(() => manager.reply("f2", "nope"), SessionValidationError);
});

Deno.test("editComment() updates a user comment and rejects agent comments / bad indexes", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "typo hree"); // f1
  manager.applyPush([{ to: "f1", content: "agent answer" }]); // adds agent comment at index 1

  const edited = manager.editComment("f1", 0, "typo here");
  assertEquals(edited.comments[0]!.content, "typo here");

  assertThrows(() => manager.editComment("f1", 1, "x"), SessionValidationError); // agent-authored
  assertThrows(() => manager.editComment("f1", 9, "x"), SessionValidationError); // no such index
  assertThrows(
    () => manager.editComment("f404", 0, "x"),
    SessionValidationError,
  ); // unknown item
});

Deno.test("deleteFeedback() removes an item entirely", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.deleteFeedback("f1");
  assertEquals(manager.getState().feedback, []);
  assertThrows(() => manager.deleteFeedback("f1"), SessionValidationError);
});

Deno.test("resolve()/reopen() only apply to asks; a change request can't be resolved", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.addFeedback("change", "fix"); // f2

  manager.resolve("f1");
  assertEquals(
    manager.getState().feedback.find((f) => f.id === "f1")!.resolved,
    true,
  );

  manager.reopen("f1");
  assertEquals(
    manager.getState().feedback.find((f) => f.id === "f1")!.resolved,
    false,
  );

  assertThrows(() => manager.resolve("f2"), SessionValidationError);
});

Deno.test("applyPush() replies to asks and removes addressed change requests, atomically", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "explain this"); // f1
  manager.addFeedback("change", "shorten it"); // f2

  manager.applyPush([{ to: "f1", content: "here's why" }], ["f2"]);

  const feedback = manager.getState().feedback;
  assertEquals(feedback.length, 1); // f2 removed
  assertEquals(feedback[0]!.id, "f1");
  assertEquals(feedback[0]!.comments.length, 2);
  assertEquals(feedback[0]!.comments[1]!.author, "agent");
});

Deno.test("applyPush() rejects a bad id and leaves state untouched", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  const before = manager.getState();

  assertThrows(
    () => manager.applyPush([{ to: "f404", content: "x" }]),
    SessionValidationError,
  );
  assertThrows(() => manager.applyPush([], ["f1"]), SessionValidationError); // f1 is an ask, not a change
  assertEquals(manager.getState().feedback, before.feedback);
});

Deno.test("pull() returns only what is new since the last pull", () => {
  const manager = new SessionManager("text");

  // Nothing yet.
  assertEquals(manager.pull().feedback, []);

  // A new ask and change are delivered once, then not again.
  manager.addFeedback("ask", "explain", "text"); // f1
  manager.addFeedback("change", "shorten"); // f2
  const first = manager.pull();
  assertEquals(first.feedback.map((f) => f.id), ["f1", "f2"]);
  assertEquals(first.status, "open");
  assertEquals(first.feedback.find((f) => f.id === "f1")!.quote, "text");
  assertEquals(manager.pull().feedback, []);

  // A reply re-surfaces only that item, carrying only the new comment.
  manager.reply("f1", "still unclear", "user");
  const second = manager.pull();
  assertEquals(second.feedback.map((f) => f.id), ["f1"]);
  assertEquals(second.feedback[0]!.comments.length, 1);
  assertEquals(second.feedback[0]!.comments[0]!.content, "still unclear");
});

Deno.test("pull() never echoes the Agent's own replies back", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.pull(); // delivered once

  // The Agent replies; that alone is not new feedback to act on.
  manager.applyPush([{ to: "f1", content: "answer" }]);
  assertEquals(manager.pull().feedback, []);

  // A fresh user reply does surface — but only the user's words.
  manager.reply("f1", "thanks, follow-up", "user");
  const delta = manager.pull();
  assertEquals(delta.feedback[0]!.comments.map((c) => c.content), [
    "thanks, follow-up",
  ]);
});

Deno.test("pull() skips resolved asks and re-delivers them on reopen", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.pull(); // delivered once

  manager.resolve("f1");
  assertEquals(manager.pull().feedback, []);

  manager.reopen("f1");
  assertEquals(manager.pull().feedback.map((f) => f.id), ["f1"]);
});

Deno.test("pull() on a closed session reports the review is complete", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("change", "fix"); // still pending, but the review is over
  manager.end();

  const result = manager.pull();
  assertEquals(result.status, "closed");
  assertEquals(result.feedback, []);
  assertMatch(result.message ?? "", /fully resolved/);
});

Deno.test("mutating actions reject once the session is ended", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.end();
  assertEquals(manager.getState().status, "closed");

  assertThrows(() => manager.addFeedback("ask", "y"), SessionValidationError);
  assertThrows(() => manager.reply("f1", "y"), SessionValidationError);
  assertThrows(() => manager.editComment("f1", 0, "y"), SessionValidationError);
  assertThrows(() => manager.deleteFeedback("f1"), SessionValidationError);
  assertThrows(() => manager.resolve("f1"), SessionValidationError);
});

Deno.test("getState() returns a defensive copy", () => {
  const manager = new SessionManager("text");
  const state = manager.getState();
  state.document = "tampered";
  state.feedback.push({ id: "x", kind: "ask", comments: [] });
  assertEquals(manager.getDocument(), "text");
  assertEquals(manager.getState().feedback, []);
});

Deno.test("a change event fires after each mutation", () => {
  const manager = new SessionManager("text");
  let changes = 0;
  manager.on("change", () => (changes += 1));

  manager.addFeedback("ask", "q"); // f1
  manager.reply("f1", "a", "user");
  manager.resolve("f1");
  manager.setDocument("new");
  manager.end();

  assertEquals(changes, 5);
});

Deno.test("renderTranscript() records the discussion as readable markdown", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "why this?", "some span"); // f1
  manager.applyPush([{ to: "f1", content: "because reasons" }]);
  manager.addFeedback("change", "make it shorter"); // f2
  manager.end();

  const md = renderTranscript(manager.getState());
  assertMatch(md, /# Review transcript/);
  assertMatch(md, /## f1 · Question \(open\)/);
  assertMatch(md, /> some span/);
  assertMatch(md, /\*\*Reviewer:\*\* why this\?/);
  assertMatch(md, /\*\*Agent:\*\* because reasons/);
  assertMatch(md, /## f2 · Change request \(pending\)/);
});

Deno.test("renderTranscript() handles an empty review", () => {
  const md = renderTranscript(new SessionManager("text").getState());
  assertMatch(md, /No feedback was left\./);
});
