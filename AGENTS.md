# AGENTS.md — Duckroom Project Instructions

## Source of truth

- `../docs/DUCKROOM_MASTER_PLAN.md` is the only architectural authority.
- `plan.md` is the execution procedure for Phase 0–3.
- `../docs/AGENT_HANDOFF.md` is the current state summary.
- `../docs/archive/` contains historical evidence only.

## Engineering rules

- Never infer PASS from a historical acceptance report.
- Never treat mocked Supabase/S3 behavior as live infrastructure verification.
- Never use legacy S3 namespaces for new writes.
- Lifecycle/destructive mutations must carry an expected revision and fail on stale state.
- PostgreSQL errors must remain distinguishable from an empty library.
- Manifest is migration/recovery/snapshot data only, never runtime truth.
- Do not commit `node_modules`, `dist`, `.vercel`, build output, caches, or local environment files.
- Before closing any phase, run the required clean verification commands in a native environment.
- Do not begin Phase 4 until `docs/audit/CURRENT_VERIFICATION.md` and the Master Plan exit criteria are satisfied.
