# TICKET-23 · Final from-scratch check

- **Priority:** P0 · **Day:** 19 Nov · **Estimate:** 2 hours · **Assignee:** Claude Code
- **Depends on:** all P0 tickets
- **Status:** not started

## Goal

Making sure what we submit really runs on a machine that has never run it before.

## Scope

- Copy the project to a clean new folder (or `git clone` if a repository exists), without `node_modules`, without database files, without `.env`.
- Follow the README word for word: install, seed, run, demo reset, evaluation.
- Run the full test suite.
- Run the three demo cases following the script, once with network and once without.
- Check the repository: no API keys, no `.env`, no data resembling real people, no unnecessary large files.
- Match the submission contents against `docs/submission.md` item by item.
- Write the results in `docs/final-check.md`: what passed, what failed, what was not checked.

## Out of scope

New features. Code overhaul.

## Done when

- [ ] Installation from scratch succeeds with only the README
- [ ] All tests pass, with their output copied into the check results
- [ ] All three demo cases complete with and without network
- [ ] Every official requirement item is marked met or has a reason why not
- [ ] Every failure has been fixed or written into `docs/limitations.md`

## Notes

Report results as they are. If a test fails and there is no time to fix it, write that down.
