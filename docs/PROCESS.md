# How a release is made

The owner decides what is built. One Claude session leads: it writes the plan and the spec, gives the work to engineers, checks their reports, commits, verifies and releases. Engineers and testers are other Claude sessions or agents, each with its own files.

## Steps

| Step | Who | Result |
|---|---|---|
| 1. Findings | Lead | The log of a play test, read and explained. Every defect gets an id and its place in the code. |
| 2. Plan | Lead, approved by the owner | `PLAN.md`: what the release does in plain words, the new settings, the estimate, what is left out |
| 3. Spec | Lead | `SPEC.md`: rules, parts with their files and owners, the interfaces between the parts, the exact texts, the tests to write |
| 4. Build | Engineers, at most three at a time | Each part with its unit tests. A report as text: what changed, exports, requests to other parts, what was not done, test numbers, decisions made alone. |
| 5. Handoff | Lead | `HANDOFF.md`: what a finished part gives to the parts that follow; it wins over the spec |
| 6. Tests from the spec | An independent tester | Unit tests written from the spec, not from the code. A failing test is a finding, not something to bend. |
| 7. Real server | A tester | The scenarios of `tests/world`, with the reflexes on, in a test base like the base of the owner, and one long run |
| 8. Decisions | Lead | `DECISIONS.md`: every defect the tests found, with the decision and the owner of the correction |
| 9. Fix round | Engineers | Corrections, each proven on the real server |
| 10. Verification | Lead | A fresh checkout with a fresh install: unit, end-to-end and world tests |
| 11. Release | Lead | Changelog, pull request, merge with `--match-head-commit`, tag, a play test guide for the owner |
| 12. Play test | Owner | The next findings |

## Rules for engineers

- Change only the files of your part. A change you need elsewhere is a request in your report.
- No git command that writes. The lead commits.
- Never use a named import for a function that does not exist yet: it breaks the loading of the module and hundreds of tests. Reach new functions of other parts at run time with optional chaining.
- Run single test files while you work and the full run once at the end. Report the numbers and the owner of each failure.
- Every text the spec gives is used word for word.
- Say plainly what you decided yourself and where the spec was unclear or wrong.

## Journey scenarios, the gate of a release

Learned from v0.1.4.9: 72 scenarios passed and the bot could not follow the owner down a ladder, because
the spec told the tester to move the bot with the test control where the bot could not walk. So:

- A release is done only when the journey scenarios pass: the first minutes of the owner with the bot,
  played by a second bot with the owner's own words and walks, in the owner's base, with an empty memory.
  They pass on facts of the world, never on texts alone.
- The test control never moves the bot under test. It builds the world and plays the owner. What the bot
  cannot do by itself is a failure of the bot.
- The tester of the journeys gets what the owner gets: `PLAYTEST.md`, `CHANGELOG.md`, the README of the
  tests and the owner's logs. Never the spec, never the handoff. Every promise of the play test guide is
  a scenario, or it is not in the guide.
- The journeys are written from the plan, before the build, and fail on the old code.
- The journeys run at every integration; the full set once, in the fresh checkout.
- The test base is built from the owner's world (a dump of the blocks around home), not from a description.

## Rules for testers

- Test what the spec demands, not what the code does. Leave a failing test failing, with a comment that names the finding.
- A scenario checks the world, not only the text: the blocks, the entities, the state of a door, the process of the agent.
- Order the defects by the harm they would do in play.

## Where things run

- Locally on the owner's machine, or in the cloud. The cloud downloads the server of Minecraft by itself. Both work; see `CLAUDE.md` for Node and line endings.
- The lead never changes the checkout of the owner while a bot may be running in it. Work happens in a separate worktree or in a cloud checkout.
