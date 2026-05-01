# ElevateOS Dashboard

This dashboard is the local control surface for Elevate Agent. Keep changes aligned
with the parent repository guidance in `../AGENTS.md`.

## Development

- Run `npm run typecheck` from the repository root for TypeScript checks.
- Run `npm --prefix dashboard run lint` or `npx tsc --noEmit` from this folder for dashboard-only checks.
- Keep gateway-facing API calls in `src/lib/elevate-gateway-client.ts`.
- Keep agent roster and file-backed agent data logic in `src/lib/data/agents.ts`.

## UI

- Prefer existing components under `src/components/ui`.
- Keep runtime/settings screens local-first and safe when the gateway is offline.
- Do not hardcode Skyleigh-specific values into reusable dashboard components.
