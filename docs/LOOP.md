# How work happens here

Lattice is built by a team of agents running a queue, and the loop is the same every cycle:

```
   .lattice/tasks.json ──▶ dispatch (≤6 parallel, disjoint paths) ──▶ npm run verify
            ▲                                                             │
            └────── advance queue, commit per task, push ◀────────────────┘
```

Run one cycle with **`/lattice-cycle`**. Run them until the queue is empty with
**`/loop /lattice-cycle`**.

## The roles

| role | what it is for | why it exists separately |
|---|---|---|
| **architect** | designs a package's public API as an RFC before anyone implements it | an API designed by its implementer is shaped for its implementer |
| **builder** | implements exactly one package to its RFC | one owner per package is what makes parallel work safe |
| **auditor** | attacks a finished package adversarially | the author cannot see the case they did not think of; that is not a character flaw, it is the same blind spot twice |
| **perf** | measures against the frame budget and proves every claim | performance opinions about JavaScript are wrong more often than right |
| **designer** | builds the demo game and reports where the kit fought back | the only honest test of a kit is a game built from it |
| **scribe** | arrives cold and records where navigation failed | "agent-first" is a claim, and claims get tested |

The visionary roles — architect and designer — are the ones with license to argue with the
brief. A design task that only ratifies its inputs was a wasted cycle.

## The rules that keep parallelism safe

1. **Disjoint paths, always.** Agents share one working tree. Two agents in one directory
   means the second one's write wins and the first one's work is gone with no error.
2. **The gate is run by the orchestrator, not self-reported.** An agent saying "verify
   passes" is a claim. `npm run verify` is a result.
3. **One task, one commit.** A cycle that lands six tasks lands six commits, each revertable
   on its own.
4. **Nothing lands red.** There is no "fix it next cycle": the next cycle starts from this
   tree, and a red base makes every subsequent failure ambiguous.
5. **Cross-package findings are routed, not fixed in place.** An agent that spots a bug
   outside its paths writes it into its report; the orchestrator turns it into a task.
