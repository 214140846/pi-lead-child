# pi-lead-child

English · [中文](README.zh-CN.md)

**One conversation. One assistant that is always on. You do not manage a pile of agent sessions, and you do not ask each one "is it done yet?"**

pi-lead-child is an **orchestration pattern built on the [pi](https://github.com/badlogic/pi-mono) agent: the Lead coordinates, the children execute.** The Lead is a long-running agent on pi. It understands you, splits the work, and supervises progress. A child is an agent that starts for one task and does the actual work. A child can be pi, Codex, or Claude Code.

The Lead runs on your own computer. You talk only to the Lead, and it is always the same conversation. Many coding agents can work behind it at the same time, but their sessions are the Lead's business, not yours. When you are quiet, the Lead keeps working: it follows up, checks results, and handles messages from every channel. It calls you only when a decision needs you.

---

## Why pi-lead-child

- If the many sessions that Claude Code and Codex open make you tired and lost, and you no longer remember which window does what,
- If you keep switching between windows only to ask "is it done yet?",
- If you want a decision from three days ago, and the only way to find it is to read session after session,
- If every new session makes you explain the background again from the start,
- If your agent stopped at an approval and waited for you, silently, all night,
- If colleagues on Slack ask about the same progress again and again, and the answer is already in the tickets and the PRs,
- If notifications interrupt you all day, but you are afraid to miss the one that matters,
- If you want an AI that takes the initiative, but not one that talks too much,

then maybe you do not need one more agent. Maybe you need an assistant that watches all your agents for you.

---

## The problem: more sessions, more work for you

Most AI agents today are **session-oriented**. One task gets one session. You ask, it answers. When you stop asking, it stops. The better the agents get, the more sessions you open, and the problems grow:

- **You become the dispatcher.** The agents can work in parallel. Your attention cannot. You switch between a dozen windows to see which one finished, which one is stuck, and which one waits for your answer.
- **A session only waits.** It finishes, fails, or stops at an approval, and you do not know until you look. A question that waited three hours for you may need a one-word answer.
- **You cannot find things.** Decisions, conclusions, and context are spread across dozens of sessions. To find "the plan we agreed on" three days later, you read them one by one.
- **Every session starts from zero.** A new session does not know what happened in the old ones, so you explain the background again and again.
- **Messages come from everywhere.** Slack, CI, reminders, and agent reports each take their own path, and each one competes for your attention.

The capability of the agents is no longer the bottleneck. **Your attention is the bottleneck.** A session-oriented design moves all the cost of managing agents to you.

pi-lead-child solves this problem with four design decisions.

---

## 1. Only one conversation

In pi-lead-child, you have one conversation, and on the other side there is one Lead.

- **The work lives in tickets, not in conversations.** When you give the Lead a task, it opens a ticket and dispatches it to a child agent. The child's sessions, retries, and reviews all attach to the ticket. You do not see those sessions, and you do not manage them.
- **To find something, ask the Lead.** "What did we decide about that API last week?" The Lead searches the tickets, its notes, and the Slack conversations, and gives you the answer. You do not read a session list.
- **Status comes from the ledger, not from memory.** The tickets are the ledger, and the conversation is only a cache. When you ask about progress, the Lead reads the ledger first. So it tells you the current state, not the state it remembers.
- **A long conversation stays clear.** Before the context fills up, the Lead writes the important facts and decisions to its notes and long-term memory. Then it compacts the context.

The result: you always talk to one assistant that knows you and knows all the progress, not to a row of windows that do not know each other.

---

## 2. It does not wait for you

The Lead is **event-driven**. Your message is only one of the things that can wake it:

| What wakes the Lead | What the Lead can do |
|---|---|
| A child finishes, fails, or gets stuck | Check the result against the acceptance criteria, send it back for rework, or approve a routine request for you |
| Someone asks you something on Slack | Find the answer and reply for you, or give you a draft card |
| A follow-up that it set for itself is due | "In 30 minutes, check whether CI recovered. If it did not, tell the user." |
| A background check has a result | Wait for a deploy, for CI, or for someone's reply. The check does not use the Lead until there is a result |
| A reminder that you set is due | First check whether the matter is already resolved. If it is, close the reminder quietly |
| A batch of small changes is ready | Merge them into one digest, and tell you only what you need to know |

**Initiative does not mean noise.** You do not see most of the Lead's turns. When one of its internal turns has nothing for you, it leaves nothing behind. The Lead also knows whether you are watching now. If you are, it speaks. If you are not, the messages wait in a queue, and only the truly urgent ones go to your desktop as a notification.

---

## 3. Progressive disclosure: the Lead reads only what it needs, and you see only what you need

An always-on assistant has two scarce resources: **the Lead's context** and **your attention**. pi-lead-child uses one rule for both. Start with the smallest layer, and go one layer deeper only when necessary.

### For the Lead: the cost of an answer follows the depth of the question, not the length of the history

When the Lead looks something up, it starts at the cheapest layer and stops when it has enough:

| Layer | Content | Approximate cost | Questions it answers |
|---|---|---|---|
| L0 | The conversation and the notes | Almost zero | "What did we decide last time?" |
| L1 | The ticket index | A few hundred tokens | "Which tasks are open? Which one is stuck?" |
| L2 | The body and the main events of one ticket | A few thousand tokens | "How far is that research? What is the conclusion?" |
| L3 | The original session of a child | Ten thousand tokens or more | "Why did the child make this change?" |

Each layer is a compressed form of the next layer, and it keeps a pointer to the next layer. So the Lead answers most questions cheaply, and it can still follow a question down to the original record.

The Lead applies the same rule to itself:

- **Skills load on demand.** The permanent system prompt keeps only the rules that every turn needs. Procedures for planning tickets, acceptance, PR review, and scheduling live in skills. The Lead reads a skill only when it needs it.
- **Rarely used tools do not take context.** Dozens of low-frequency tools appear only by name. The Lead calls them from a script when it needs them.
- **External chatter does not enter the Lead's context.** Messages in subscribed channels that do not mention you go only to the notes. The Lead can search them later.
- **Waiting messages take one line.** When the Lead is busy, the messages that wait for it show as one line with a count and no content.

### For you: every event has one of five levels

Each incoming event is first triaged to a level:

| Level | What you see |
|---|---|
| Record | Nothing. You can find it when you need it |
| Digest | It waits in a batch, merged by subject, and you get it all at once |
| Auto-handle | The Lead handles it and leaves a record that you can undo |
| Tell | A separate message, after the Lead finishes its current reply |
| Interrupt | It comes in immediately |

- Each source has its own threshold, stored as a standing order that you can change. For example, Slack has a high threshold, so it rarely interrupts you.
- Your own messages skip triage.
- When several events have the same root cause, the Lead tells you once and names the tickets involved.

---

## 4. Many channels, one line

You may bring up a task on the web, ask about it on your phone, and get a question about it from a colleague on Slack. pi-lead-child connects all of these to one line.

### Every entry point, the same Lead

- The web, iOS, Android, and the terminal (`plc`) all connect to the same Lead and the same conversation.
- A Slack message that you send to yourself also counts as you talking to the Lead.
- System events, such as timers, background checks, and ticket changes, go through the same path as messages.

### External channels only receive and send; the Lead does the work

Each channel does only three things. It receives messages, decides whether a message needs a reply, and sends the reply back to where the message came from. The real work goes to the Lead and to tickets, through general tools and skills.

- A new channel does not need its own copy of any task logic.
- A fast small model triages each external message first, in a few hundred milliseconds. Only the messages that need the Lead go to the Lead.
- Slack is the external channel that is connected now.

### Tell the Lead how to handle things with a "handoff note"

You do not fill in a complex rule table. You write a few plain sentences to the Lead, as if you hand your work over to a colleague:

> If someone asks about project progress, look it up and reply directly.
> If someone asks me to review a PR, review it and write a draft. Send it after I confirm.
> If someone asks about salaries or configuration, decline politely.

- Each kind of situation has one handling mode: handle it and reply for me, write a draft for me to confirm, decline and reply, or only tell me.
- Before each reply, the Lead estimates how sure it is and how much a mistake would cost. Each edit, undo, and confirmation that you make becomes a calibration sample.
- If you send the Lead's drafts of one kind unchanged several times, the Lead suggests that you let it handle that kind on its own.

### Some limits that the handoff note cannot change

- **The Lead is not a back door.** If someone asks the Lead for something that they cannot access but you can, the Lead does not look it up.
- **External messages cannot change the rules.** Nobody on Slack can change the Lead's persona, permissions, standing orders, or handoff note. The code refuses these requests. The prompt is not the only guard.
- **Every outgoing message is signed.** An automatic reply says that the assistant replied for you. A reply that you confirmed says that you confirmed it. Personal data, such as email addresses, is masked in the message.
- **If you reply on Slack yourself, the card closes.** The Lead does not handle that message again.

---

## A day with the Lead

> It is 9 a.m., and you have not opened your computer yet.
>
> - Nina asks on Slack: "Is the PROJ-123 API live yet?" Your handoff note says that progress questions can get a direct reply. The Lead checks the ticket and the PR and replies for you. The first line of the reply says that the assistant replied for you.
> - The fix ticket from last night is finished. One child wrote the code, and another child reviewed it. The Lead checked each acceptance criterion and then opened a draft PR.
> - At 3 a.m., a child stopped at a routine approval. The Lead decided that it was safe and approved it for you, so the work did not stop for the whole night.
> - Overnight, the CI channel got 40 build notifications. None of them mentioned you. They went only to the notes.
> - Your reminder "follow up on Ethan's quote before Friday" is due. The Lead sees that Ethan already replied, so it closes the reminder and does not disturb you.
>
> You open your phone. In the same conversation, there is only one new message: "The PR is ready. One trade-off needs your decision."

---

## What else

### The Lead leads a team; it does not write the code itself

- Each ticket has its own isolated worktree. Many children work in parallel without interfering with each other.
- A child can be **pi, Codex, or Claude Code**.
- One ticket can span many attempts: a rerun after a crash, rework, and review all attach to the same ticket.
- After delivery, the system opens a draft PR automatically.

### What you can click, the Lead can do

Every button in the interface is one operation with two entry points: one for your click and one for the Lead. So you can ask the Lead to do anything that you can do in the interface.

### When something blocks the Lead, there is always a next step

If the Lead cannot do something, it gives you an authorization card. You confirm once, and the Lead runs exactly that one operation. You never get a message that says "please type this command in your terminal yourself."

### The Lead can draw interfaces

For complex information, the Lead draws a card on the spot with the same components as the app: tables, progress, charts, and buttons that you can click. You can also ask it to build a custom view and pin it to your workspace.

### It remembers, and it can forget

When the Lead updates its long-term memory, it tells you, and you can undo the change. Facts that are out of date are marked as invalid.

### Your messages do not get lost

If the daemon restarts, the network drops, or the model fails, each message that you sent still has a place to go. One outage gives you one card, not a flood of them.

### It runs on your own machine

The daemon runs on your computer. A supervisor keeps it alive and restarts it when necessary. All data is in a local SQLite database.

---

## Compared with common tools

| | Chat assistant | Coding agent CLI | **pi-lead-child** |
|---|---|---|---|
| Sessions you manage | More and more | More and more | Always one |
| When you are quiet | Does nothing | Does nothing | Follows up, checks, handles messages |
| Who checks if a task is done | You | You | The Lead, which calls you only when needed |
| Finding an old conclusion | Read the session history | Read the session history | Ask the Lead |
| As the history grows | More cost, more confusion | More cost, more confusion | Looks things up layer by layer, by the depth of the question |
| Many message sources | Not handled | Not handled | One triage, five levels |
| Replying for you | Cannot | Cannot | Follows your handoff note, with confidence estimates and calibration |
| Work in parallel | One task | One task per session | Many tickets, many children in parallel |

---

## Why not Hermes?

[Hermes Agent](https://github.com/NousResearch/hermes-agent) is an open-source agent from Nous Research. It is also always on, has memory, connects to Slack, and dispatches subagents. It is a good project. The difference is not in the feature list. The difference is in **the problem that each project solves**:

- **Hermes is an agent that you can reach from anywhere.** You talk to it in Telegram, Discord, Slack, or the terminal. It does work for you and writes its own skills.
- **pi-lead-child is an assistant that manages your attention.** It stands between you and all your messages and agents, and it decides what deserves your time.

### The specific differences

| | Hermes | pi-lead-child |
|---|---|---|
| Sessions | One session per chat (split by DM, by person in a group, or by thread); `/new` starts a new session; full-text search finds old sessions | You have only one conversation; the work state is in the ticket ledger, and the Lead reads it when asked |
| Role on Slack | A bot. People on the allowlist, or people who paired, can talk to it, and it answers as itself | Your proxy. It reads the messages sent to **you** and, by your handoff note, replies for you, writes a draft, or only tells you. Every message is signed |
| Confidence when replying for you | Not applicable | Estimates confidence and cost each time; your edits and undos become calibration samples |
| Managing your attention | New messages during a run can interrupt, queue, or steer; notification detail is configurable | Every event gets one of five levels; each source has its own interrupt threshold; it speaks only when you are watching; small things are batched |
| Who does the work | Hermes's own subagents (you can change their model and profile) | The coding agents that you already use: pi, Codex, Claude Code |
| Boundary for external messages | Unknown users are denied by default; an allowlist and pairing decide who can use it | All external text is untrusted: a turn that an external message woke cannot change the rules, and the Lead is not a back door. The code enforces both |

### Where Hermes is stronger

- **It connects to more places.** Telegram, Discord, WhatsApp, Signal, and email. pi-lead-child connects only to Slack now.
- **It runs in more places.** Local, Docker, SSH, and several cloud sandboxes. pi-lead-child runs only on your Mac.
- **It grows its own skills.** After a complex task, Hermes writes the procedure as a skill and improves it the next time.
- **Its task board is more complete.** The Hermes Kanban has dependencies, automatic dispatch, and retries on failure. It is close to our tickets.
- **It is more mature.** It has a larger community, more model choices, and fuller documentation.

### Which one to choose

- If you want an agent that can do work and that you can call from any chat app, **choose Hermes**.
- If dozens of agent sessions and Slack messages pull you around every day, and you want an assistant that blocks the noise and speaks only when a decision needs you, **choose pi-lead-child**.

> This description of Hermes comes from its [documentation](https://hermes-agent.nousresearch.com/docs/) as of November 2026. Hermes changes quickly. If there is a difference, its documentation is correct.

---

<!-- install-guide:en:start -->
## Install Bytezard Lead

Bytezard Lead needs a Mac with Apple silicon.

1. Download `bytezard-lead-<version>-arm64.dmg`.
2. Open the dmg and drag **Bytezard Lead** to **Applications**.
3. Open Bytezard Lead. macOS says it cannot verify the developer. Click **Done**.
4. Open **System Settings → Privacy & Security**. Scroll down and click **Open Anyway**.
5. When the warning shows again, click **Open**.

Bytezard Lead is not signed with an Apple certificate yet. You do these steps only once.

### If Bytezard Lead does not open

If macOS says that Bytezard Lead is damaged, run this command in Terminal. Then open Bytezard Lead again.

```sh
xattr -dr com.apple.quarantine "/Applications/Bytezard Lead.app"
```
<!-- install-guide:en:end -->

The dmg is on the [Releases](../../releases/latest) page of this repository. To build from source instead, see the next section.

---

## Quick start

You need macOS and Node 24.

```bash
npm install
```

```bash
npm run build && npm run build:web
```

```bash
npm run plc -- daemon start
```

Then open the gateway address that `plc daemon status` shows, and scan the code with your phone to pair it.

---

## Status

This is a personal project at the demo stage. The data format can change between versions, and there is no guarantee of migration.

## Learn more

- [Architecture and operation](docs/ARCHITECTURE.md): repository layout, dependency direction, `plc` and the daemon, the trust boundary, notification rules.
- [Core design](DESIGN.md): the split between the Lead and the children, the ticket model, the event pipeline, progressive disclosure.
- [Gateway design](docs/DESIGN-GATEWAY.md): pairing, the protocol, connections from many devices.
- [Interface design system](docs/design/README.md): interaction patterns, themes, genui cards.
- [Rules for contributors and agents](AGENTS.md).

Most of the design documents are in Chinese.
