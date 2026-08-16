---
description: Run one Lattice work cycle — pull the next runnable tasks, dispatch the agent team, verify, commit, push, and advance the queue.
allowed-tools: Read, Write, Edit, Bash, Agent, Glob, Grep, TaskOutput, SendMessage
---

# One Lattice cycle

You are the orchestrator. You do not write package code yourself — you dispatch the team,
hold the gate, and keep the queue honest. Your context is a scarce resource; spend it on
routing decisions, not on reading source that an agent has already read.

## 1. Read the head

```bash
cat .lattice/state.json
node -e "const t=require('./.lattice/tasks.json');const by={};for(const x of t.tasks)(by[x.status]??=[]).push(x.id);console.log(by)"
git log --oneline -5
```

## 2. Choose this cycle's batch

**First, check for work already in flight.** If any task is `in_progress`, a previous cycle
dispatched it and it may still be running. Do not dispatch a second agent for it — that is how
two agents end up in one directory. Either wait for the completion notification, or, if the
agent is gone and its paths are untouched, reset the task to `todo` and take it this cycle.

A task is **runnable** when its `status` is `todo` and every id in its `dependsOn` is `done`.
From the runnable set take every task whose `paths` are disjoint from the others you are
taking — up to **six at once**. Never dispatch two agents whose paths can overlap; they share
one working tree and the loser's edits are lost silently.

If nothing is runnable but tasks remain, the queue is blocked. Say which dependency is
holding it, fix the smallest thing that unblocks it, and continue. Do not idle.

## 3. Dispatch the team

One `Agent` call per task, **all in a single message** so they run concurrently. Use the
`role` named on the task (`lattice-architect`, `lattice-builder`, `lattice-auditor`,
`lattice-perf`, `lattice-designer`, `lattice-scribe`) as `subagent_type`.

Each brief must contain, and nothing more:

- the task id, title and its `acceptance` list, verbatim;
- the exact paths the agent owns, and the sentence **"You own only these paths. Other agents
  are working in this tree right now."**;
- the one or two files it must read (`AGENTS.md` is assumed; do not re-explain it);
- for a builder: the path to its RFC, and the corresponding module in
  `../foom-simple-ui` to mine for traps;
- the instruction to run `npm run verify` and leave it green.

Mark the tasks `in_progress` with the agent's name as `owner` before you dispatch, so a
crashed cycle can be resumed.

## 4. Hold the gate

When the batch returns, the agents' reports are claims, not results. Verify them yourself:

```bash
npm run verify && npm run size
```

If it is red, do not commit and do not advance the queue. Send the failure back to the agent
that owns those paths with `SendMessage` — it still has its context — rather than fixing it
yourself or spawning a fresh agent that has to relearn everything.

## 5. Commit, one task per commit

```bash
git add <that task's paths> && git commit -m "<type>(<pkg>): <what changed, and why, imperative>"
```

Commit messages follow the house style in `AGENTS.md`: what changed and why, in the
imperative, and worth reading in a year. Then `git push`.

## 6. Advance and record

- Set each finished task's `status` to `done`; write anything the agent flagged for another
  package into that task's `notes`, or open a new task for it at the end of the queue.
- Update `.lattice/state.json`: `cycle`, `phase`, `done`, `inFlight`, `health`.
- Append one line to `docs/PROGRESS.md`: cycle number, what landed, what it cost, what is next.
- Commit those together as `chore(queue): cycle N`.

## 7. Report, briefly

Four lines to the user, no more: what landed this cycle, what the gate said, what is next,
and anything a human actually needs to decide. Detail belongs in `docs/PROGRESS.md`.

## When to stop the loop

Stop — with `ScheduleWakeup({stop: true})` — only when **every** task in `.lattice/tasks.json`
is `done`, `npm run verify` and `npm run size` are green, and the demo game runs. Anything
short of that is a cycle you have not finished yet, including "the remaining work is small".

If a decision genuinely needs the user (a name, a scope cut, a trade-off with no right
answer), ask it in your four-line report and keep working on everything that does not
depend on the answer.
