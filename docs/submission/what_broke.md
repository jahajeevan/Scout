# What broke, and how I got out

> Draft for the Razorpay Buildathon Google Form. Razorpay explicitly says
> *"the last one is the one we read first."* This is the single highest-leverage
> answer in the whole submission — worth iterating.
>
> **Target length:** ~500–700 words. Long enough to prove depth, short enough
> that a tired reviewer finishes it. Voice: honest + technical + a little dry.
> Not "I'm a hero," not "I struggled bravely." Just: here's what happened.

---

## The bug that taught me the most

Scout has a permission gate: every tool that changes something in the real
world — send an email, edit a file, run a shell command — is declared
`CONFIRMATION_REQUIRED` and can only run when the caller passes
`confirm=True`. It's a single-line policy enforced in one place
(`backend/tools/base.py`), and I was proud of it.

Then I asked Scout to send a test email over chat.

Scout said: *"Ready to send that email — confirm?"*
I said: *"yes go ahead."*
Scout said: *"Ready to send that email — confirm?"*
I said: *"yes."*
Scout said: *"Ready to send that email — confirm?"*

Every time I said yes, Scout re-called `send_email(confirm=False)`. The
gate refused again. The model apologetically asked for confirmation
again. The user (me) had no way to actually grant it.

## Why it happened

The streaming chat loop (`orchestrator.run_stream`) was doing exactly what
I told it to. When a tool returned `needs_confirmation`, my code appended
a `role=tool` message back to the conversation reading:

> ACTION NOT PERFORMED. `send_email` needs the user's explicit confirmation.
> Tell the user you're ready and ask them to confirm — do NOT say it's done.

Which is *correct in one turn*. But on the NEXT turn, when the user said
"yes," the model — trained to be helpful — did exactly what it seemed like
it should: it called `send_email` again. Which the gate refused again.
Which produced the same message. Which the model followed again.

The permission gate was fine. The tool was fine. The model was doing what
the prompt told it. But the *loop between them had no way out*. There was
no path for the user's "yes" to reach the tool call.

## The fix

I gave `run_stream` an `on_confirm` callback:

```python
if result.needs_confirmation:
    if on_confirm is not None:
        await on_confirm({"tool": tc.name, "args": tc.arguments,
                          "prompt": result.summary})
        return "".join(full)     # ← the loop STOPS here
```

The moment a confirm-gated tool is called, the stream terminates and
emits a `{tool, args, prompt}` event to the WebSocket. The frontend renders
a Confirm/Cancel card. When the user clicks Confirm, the frontend sends a
`confirm_yes` frame; the WebSocket handler pulls the pending action and
runs `tools.execute(tool, args, confirm=True)` — outside the model loop.

The model isn't asked to try again. The model isn't in the loop at all.
The user's consent goes directly to the tool.

## What I learned

Three things worth writing down:

**One.** The bug was invisible to unit tests because each piece was
individually correct. Permission gate — correct. Tool result — correct.
Prompt — correct. Model behavior — reasonable given the prompt. The
failure mode was in the *conversation between them across turns*, which
is exactly the surface most integration tests don't cover. Since then I've
started thinking of "the loop" as its own object worth testing directly.

**Two.** When you feed a model a message like "ACTION NOT PERFORMED,"
you're implicitly asking it to retry. Language models are helpful. If your
instruction has any ambiguity, they'll retry. The fix wasn't a better
prompt — it was removing the model from the retry loop entirely. The
right frame here isn't "how do I get the model to behave," it's "which
things belong to the model and which belong to me."

**Three.** The most important primitive in an agent product is *how the
user grants consent*. Most demos skip this — they show the agent doing
things, not the user approving them. Consent is where trust is built or
lost, and the interface for it is a first-class product decision, not a
detail. Scout now has a Confirm/Cancel card that survives streaming and
returns exactly the right power to the person on the other side.

The same pattern now protects `write_file`, `edit_file`, `run_command`,
`git_commit`, `delete_path`, and any future tool that changes state.

## The commit

Fix landed in `orchestrator.run_stream` + `/ws/chat` (`_parse_ws` handling
`confirm_yes` / `confirm_no` frames) + `Conversation.tsx` rendering the
card. Repo: [github.com/jahajeevan/Scout](https://github.com/jahajeevan/Scout).

Nothing shocking about the fix. The interesting part was how easily
"correct in every piece" hid "wrong as a system."
