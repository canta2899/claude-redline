---
name: redline
description: A live, Google-Docs-style web UI for reviewing a markdown document part-by-part. Use ONLY when the user explicitly asks for it — "structured review", "redline review", "open the review UI", "let me comment on this". Do not trigger it on your own for ordinary multi-point answers; it launches a local server and a browser page, so it's opt-in.
disable-model-invocation: true
---

# Structured review

A user-invoked workflow. A **markdown file on disk is the document under review**;
the user reads it in a local web UI and, on any part of it, either **asks a
question** or **requests a change** (they can also comment on the whole
document). You work the feedback over as many rounds as needed — answering
questions and **editing the file itself** — until the user ends the review.
Everything runs through one CLI, `claude-redline`, driven with Bash, in THIS session.

The key idea: **the file is the living document.** You edit it in place with your
normal file tools; redline watches it and the UI updates live. You never
regenerate or re-upload it. When the review ends, the file *is* the result.

**When you're invoked, act — don't answer in the chat.** The user ran this
command *because* they want the review UI, so the invocation itself is the
go-ahead. Whatever text they passed after the command is the **subject**, not a
question to reply to inline — it's either what to write the document about, or
which file to point redline at. Your first move is always to get a markdown file
on disk and `open` the review on it (step 1). Don't answer their prompt in the
chat, don't summarize it, and don't ask "want me to open the review?" first —
just open it. From there the whole conversation happens in the UI, round by
round; the chat is only for the short status lines the steps below call for.

Every command below runs through the `claude-redline` binary on your PATH:

```
claude-redline <command>
```

Commands: `open`, `monitor`, `push`, `close`. One review runs at a time on a
fixed port.

## 1. Pick the file, then open the review

There are two ways in:

- **Reviewing your own response.** Write your response verbatim to a real
  markdown file in the working directory with a descriptive kebab-case name, e.g.
  `./auth-refactor-review.md`. It's the deliverable and it stays. If that name
  already exists, choose a different one — never overwrite an existing file.
- **Reviewing an existing document.** Just point redline at the user's file. Edits
  write **straight into that file in place** — that's the point. The file only
  needs to exist; it need not be staged, committed, or even tracked by git.

Then `open` it. `open` **starts a blocking server** that serves the UI and watches
the file, so launch it as a **background** process:

```
claude-redline open ./auth-refactor-review.md
```

It prints one JSON line and keeps running:
`{"url":"…","events_url":"…","document":"…"}`.
- `url` — the page to give the user.
- `events_url` — the live feedback stream (`ws://…/agent`).
- `document` — the absolute path of the file under review.

Then:
1. Show the user the `url` and tell them the review is open.
2. **Attach the live feed** — point the `Monitor` tool at `events_url`:

   ```
   Monitor({ ws: { url: "<events_url>" }, description: "redline feedback",
             persistent: true, timeout_ms: 3600000 })
   ```

3. Stop. There's nothing to do until feedback arrives.

## 2. Reacting to feedback (it comes to you)

You don't wait to be told, and you don't poll — the `Monitor` wakes you with a
frame the moment the reviewer adds, edits, or reopens anything:

```
{"type":"review-requested","status":"open","turn":<n>,"feedback":[…]}
```

`feedback` is a **delta**: only what's new since the last frame, never echoing
your own replies back. Each item has:

- `id` — the feedback id (e.g. `"f3"`); you reference it in `push`.
- `kind` — **`"ask"`** (a question — answer it) or **`"change"`** (edit the doc).
- `quote` — the exact document text it's about, when made on a highlighted span
  (absent for a comment on the whole document).
- `comments` — the reviewer's new message(s).

Frames can arrive in quick succession as the reviewer works (one per change). If
several land close together, let them settle and handle the batch in one round
rather than firing a half-answer after each.

If `status` is `"closed"`, the review is over. Write a concise final summary —
what came in, what you addressed — then `close` and finish.

If the monitor drops, re-attach it to the same `events_url`; on connect it
replays anything you haven't seen yet.

## 3. Respond: edit the file, and/or `push`

**For a `"change"` item** — edit the document **file in place** with your normal
tools (a targeted find-and-replace for small asks, a section rewrite for bigger
ones; you know the content, so don't read it back first). Saving is all it takes:
redline's watcher picks up the change and the UI updates. There is **no**
`update-source` command. Then mark the request addressed with `push` (below).

Marking a change request `addressed` **removes it** from the UI — do it only once
you've actually made the edit. If you *disagree* with a requested change, don't
address it; there's no thread on a change request, so say so to the user directly
and leave the item pending for them to withdraw.

**For an `"ask"` item** — reply in its thread via `push`. **Keep replies short**;
they render in a small thread bubble. You do **not** resolve ask threads — **only
the user does** (they fold the thread away when satisfied).

`push` takes JSON on stdin — nothing else; it never touches your filesystem. Its
`content` is markdown (backticks, quotes, `$` corrupt on `echo`/heredoc), so
write the payload to a scratch file and pipe it in. Put that file **in your
scratchpad, never the working tree**, and **you** are responsible for removing it
— `push` won't. Delete it in the *same* Bash call, with `;` (not `&&`) so it's
cleaned up even when the push fails:

- `replies`: `[{ "to": "<ask id>", "content": "<short markdown>" }]`
- `addressed`: `["<change id>", …]` — change requests you've handled (removed).

Example scratch file — answer a question and mark two changes addressed (after
you edited the file):

```
{
  "replies": [
    {"to":"f4","content":"It refreshes on a 401 and falls back to cache on a network error."}
  ],
  "addressed": ["f2","f3"]
}
```

```
claude-redline push < <scratchpad>/push.json ; rm -f <scratchpad>/push.json
```

Use the same path in both halves. The `;` (not `&&`) means `rm` runs even if the
push fails, so orphaned JSON is never left behind in the scratchpad — leaving one
there is a bug.

Then briefly tell the user what you addressed (and whether you edited the doc),
that you're ready for more, and stop. Repeat from step 2 each round.

## 4. Ending the review

The **user** ends the review from the UI ("End review"); your next frame arrives
with `status: "closed"`. Stop the server:

```
claude-redline close
```

On close, redline writes the discussion to a sidecar next to the document
(`auth-refactor-review.review.md`) — a record of what was asked and changed. The
document file itself stays clean and is the final deliverable. Point the user at
both, then finish. Always `close` so you don't leave a server running.
