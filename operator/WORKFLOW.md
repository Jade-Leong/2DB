# 2DB — workflow design and local milestone 2

**Two agents. One reproducible bug.**

1. Agent 1 receives a customer complaint, a clean scenario seed, and the application snapshot. It reproduces the complaint and proposes a code fix in a PR.
2. A human engineer reviews and approves the **exact revision** (immutable commit identifier) for sandbox testing. If the revision changes, approval must be obtained again for the new revision.
3. Agent 2 independently evaluates the original customer requirement in a disposable sandbox using isolated data. It receives requirements and the approved revision, not Agent 1's reasoning or builder answer key. It reports evidence and regressions.
4. A human engineer decides whether to merge after reviewing that evidence.

Neither agent may approve, merge, or deploy its own work. Sandbox-test approval is distinct from merge approval. Milestone 2 implements a local engineer session, exact content-snapshot approval, and scripted baseline/candidate verification in the separate `control/` application. The fixtures are developer-authored and no live agents or GitHub are connected. The resulting verified state still requires engineer review; no merge or deployment action is provided.

Keep `operator/`, this conversation, reports, and answer keys outside both investigator contexts. Use the explicit source allowlist in the main README for application handoff; folder separation alone is not a security boundary if an agent can read the whole workspace. Keep independent verification under separate operator control.

## Milestone 3 implementation

Agent 1 now has an official TypeScript Codex SDK worker and a constrained action broker. A fresh investigation requires explicit API-key/model setup and a successful Linux-container/Chromium isolation probe. The worker receives the unchanged complaint, synthetic buyer identity, intended behavior, and application-only handoff. It must gather trusted browser mismatch evidence before reading/editing source. It cannot access these notes, developer fixes, independent tests, engineer credentials, previous threads, approval APIs, or the original marketplace.

The controller computes the new source diff/hash, freezes the proposal, and stops at **Awaiting engineer approval for testing**. Agent-generated code cannot enter the milestone-2 host fixture runner. Only human-approved generated revisions can use the separate isolated baseline/candidate verifier. Agent 2 remains scripted, with no live Agent 2, GitHub PR creation, merge, or deployment.

The integration is implemented but a live run has not been demonstrated: the worker API credential/model and Docker Desktop Linux engine require local setup. See [the operating guide](../control/AGENT-1.md) and [actual milestone-3 results](MILESTONE-3-RESULTS.md). Synthetic deterministic test evidence is never presented as a live discovery. Publishing this source repository to GitHub is a developer action, not runtime GitHub integration.
