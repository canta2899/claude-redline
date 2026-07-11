import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager, SessionValidationError } from "../src/lib/session.js";
import { renderTranscript } from "../src/lib/transcript.js";

test("a new session starts open and empty around the given document", () => {
  const manager = new SessionManager("the document text");
  const state = manager.getState();

  assert.equal(state.status, "open");
  assert.equal(state.rev, 0);
  assert.equal(state.seq, 0);
  assert.equal(state.pulled_rev, 0);
  assert.equal(state.document, "the document text");
  assert.deepEqual(state.feedback, []);
});

test("setDocument() replaces the document and fires a change; a no-op does neither", () => {
  const manager = new SessionManager("original");
  let changes = 0;
  manager.on("change", () => (changes += 1));

  manager.setDocument("revised");
  assert.equal(manager.getDocument(), "revised");
  assert.equal(changes, 1);

  manager.setDocument("revised"); // identical — ignored
  assert.equal(changes, 1);
});

test("addFeedback() files asks and changes, inline (with quote) or global", () => {
  const manager = new SessionManager("some document text");

  const ask = manager.addFeedback("ask", "what does this mean?", "document text");
  assert.equal(ask.id, "f1");
  assert.equal(ask.kind, "ask");
  assert.equal(ask.quote, "document text");
  assert.equal(ask.comments.length, 1);
  assert.deepEqual({ author: ask.comments[0]!.author, content: ask.comments[0]!.content }, {
    author: "user",
    content: "what does this mean?",
  });

  const change = manager.addFeedback("change", "make it shorter");
  assert.equal(change.id, "f2");
  assert.equal(change.kind, "change");
  assert.equal(change.quote, undefined); // global
});

test("reply() appends to an ask thread but refuses a change request", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.addFeedback("change", "fix"); // f2

  const item = manager.reply("f1", "a follow-up", "user");
  assert.equal(item.comments.length, 2);
  assert.equal(item.comments[1]!.author, "user");

  assert.throws(() => manager.reply("f2", "nope"), SessionValidationError);
});

test("editComment() updates a user comment and rejects agent comments / bad indexes", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "typo hree"); // f1
  manager.applyPush([{ to: "f1", content: "agent answer" }]); // adds agent comment at index 1

  const edited = manager.editComment("f1", 0, "typo here");
  assert.equal(edited.comments[0]!.content, "typo here");

  assert.throws(() => manager.editComment("f1", 1, "x"), SessionValidationError); // agent-authored
  assert.throws(() => manager.editComment("f1", 9, "x"), SessionValidationError); // no such index
  assert.throws(() => manager.editComment("f404", 0, "x"), SessionValidationError); // unknown item
});

test("deleteFeedback() removes an item entirely", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.deleteFeedback("f1");
  assert.deepEqual(manager.getState().feedback, []);
  assert.throws(() => manager.deleteFeedback("f1"), SessionValidationError);
});

test("resolve()/reopen() only apply to asks; a change request can't be resolved", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.addFeedback("change", "fix"); // f2

  manager.resolve("f1");
  assert.equal(manager.getState().feedback.find((f) => f.id === "f1")!.resolved, true);

  manager.reopen("f1");
  assert.equal(manager.getState().feedback.find((f) => f.id === "f1")!.resolved, false);

  assert.throws(() => manager.resolve("f2"), SessionValidationError);
});

test("applyPush() replies to asks and removes addressed change requests, atomically", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "explain this"); // f1
  manager.addFeedback("change", "shorten it"); // f2

  manager.applyPush([{ to: "f1", content: "here's why" }], ["f2"]);

  const feedback = manager.getState().feedback;
  assert.equal(feedback.length, 1); // f2 removed
  assert.equal(feedback[0]!.id, "f1");
  assert.equal(feedback[0]!.comments.length, 2);
  assert.equal(feedback[0]!.comments[1]!.author, "agent");
});

test("applyPush() rejects a bad id and leaves state untouched", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  const before = manager.getState();

  assert.throws(() => manager.applyPush([{ to: "f404", content: "x" }]), SessionValidationError);
  assert.throws(() => manager.applyPush([], ["f1"]), SessionValidationError); // f1 is an ask, not a change
  assert.deepEqual(manager.getState().feedback, before.feedback);
});

test("pull() returns only what is new since the last pull", () => {
  const manager = new SessionManager("text");

  // Nothing yet.
  assert.deepEqual(manager.pull().feedback, []);

  // A new ask and change are delivered once, then not again.
  manager.addFeedback("ask", "explain", "text"); // f1
  manager.addFeedback("change", "shorten"); // f2
  const first = manager.pull();
  assert.deepEqual(
    first.feedback.map((f) => f.id),
    ["f1", "f2"]
  );
  assert.equal(first.status, "open");
  assert.equal(first.feedback.find((f) => f.id === "f1")!.quote, "text");
  assert.deepEqual(manager.pull().feedback, []);

  // A reply re-surfaces only that item, carrying only the new comment.
  manager.reply("f1", "still unclear", "user");
  const second = manager.pull();
  assert.deepEqual(
    second.feedback.map((f) => f.id),
    ["f1"]
  );
  assert.equal(second.feedback[0]!.comments.length, 1);
  assert.equal(second.feedback[0]!.comments[0]!.content, "still unclear");
});

test("pull() never echoes the Agent's own replies back", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.pull(); // delivered once

  // The Agent replies; that alone is not new feedback to act on.
  manager.applyPush([{ to: "f1", content: "answer" }]);
  assert.deepEqual(manager.pull().feedback, []);

  // A fresh user reply does surface — but only the user's words.
  manager.reply("f1", "thanks, follow-up", "user");
  const delta = manager.pull();
  assert.deepEqual(
    delta.feedback[0]!.comments.map((c) => c.content),
    ["thanks, follow-up"]
  );
});

test("pull() skips resolved asks and re-delivers them on reopen", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.pull(); // delivered once

  manager.resolve("f1");
  assert.deepEqual(manager.pull().feedback, []);

  manager.reopen("f1");
  assert.deepEqual(
    manager.pull().feedback.map((f) => f.id),
    ["f1"]
  );
});

test("pull() on a closed session reports the review is complete", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("change", "fix"); // still pending, but the review is over
  manager.end();

  const result = manager.pull();
  assert.equal(result.status, "closed");
  assert.deepEqual(result.feedback, []);
  assert.match(result.message ?? "", /fully resolved/);
});

test("mutating actions reject once the session is ended", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "q"); // f1
  manager.end();
  assert.equal(manager.getState().status, "closed");

  assert.throws(() => manager.addFeedback("ask", "y"), SessionValidationError);
  assert.throws(() => manager.reply("f1", "y"), SessionValidationError);
  assert.throws(() => manager.editComment("f1", 0, "y"), SessionValidationError);
  assert.throws(() => manager.deleteFeedback("f1"), SessionValidationError);
  assert.throws(() => manager.resolve("f1"), SessionValidationError);
});

test("getState() returns a defensive copy", () => {
  const manager = new SessionManager("text");
  const state = manager.getState();
  state.document = "tampered";
  state.feedback.push({ id: "x", kind: "ask", comments: [] });
  assert.equal(manager.getDocument(), "text");
  assert.deepEqual(manager.getState().feedback, []);
});

test("a change event fires after each mutation", () => {
  const manager = new SessionManager("text");
  let changes = 0;
  manager.on("change", () => (changes += 1));

  manager.addFeedback("ask", "q"); // f1
  manager.reply("f1", "a", "user");
  manager.resolve("f1");
  manager.setDocument("new");
  manager.end();

  assert.equal(changes, 5);
});

test("renderTranscript() records the discussion as readable markdown", () => {
  const manager = new SessionManager("text");
  manager.addFeedback("ask", "why this?", "some span"); // f1
  manager.applyPush([{ to: "f1", content: "because reasons" }]);
  manager.addFeedback("change", "make it shorter"); // f2
  manager.end();

  const md = renderTranscript(manager.getState());
  assert.match(md, /# Review transcript/);
  assert.match(md, /## f1 · Question \(open\)/);
  assert.match(md, /> some span/);
  assert.match(md, /\*\*Reviewer:\*\* why this\?/);
  assert.match(md, /\*\*Agent:\*\* because reasons/);
  assert.match(md, /## f2 · Change request \(pending\)/);
});

test("renderTranscript() handles an empty review", () => {
  const md = renderTranscript(new SessionManager("text").getState());
  assert.match(md, /No feedback was left\./);
});
