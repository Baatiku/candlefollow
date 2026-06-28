---
name: Plan mode trap
description: Calling enter_plan_mode blocks all writes; user must explicitly switch back to Build mode before any file edits can proceed.
---

## Rule
Never call `enter_plan_mode` after the user has already issued a clear build instruction (e.g. "implement everything", "go", "build it"). The tool transitions the agent into a system-enforced read-only mode that requires an explicit user mode-change message to exit.

**Why:** The tool is designed for uncertain scope, not for pre-planning work the user has already approved. Using it after approval wastes a full round-trip and can cause session compression before any real work is done.

**How to apply:** If scope is already clear from the user's message, skip enter_plan_mode entirely. Use `.local/session_plan.md` for internal task decomposition instead — it has no system-level side effects.
