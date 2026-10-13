# Wakery OpenClaw Gateway auth modes

## Purpose

Clarify the two relevant OpenClaw Gateway auth/operating modes for Wakery:

1. **current local same-host backend mode**
2. **future managed paired-device mode**

This document exists because Wakery now has a working local Gateway dispatch path, but that path does **not** show up in `openclaw devices list`.

---

## Current chosen local mode

For Wakery running on the **same host** as OpenClaw, the chosen and currently working mode is:

- `client.id = "gateway-client"`
- `client.mode = "backend"`
- local loopback Gateway connect
- shared gateway token auth
- Wakery-owned local device-signing material

This path is accepted by the local Gateway and successfully supports:
- `delivery = session` via `chat.send`
- `delivery = run` via `agent`

### Important consequence

This same-host backend path does **not** currently create a visible entry in:

```bash
openclaw devices list --json
```

Research indicates this is explained by explicit Gateway behavior that skips backend self-pairing for local authenticated backend clients.

So for local deployment, **working dispatch without listed-device enrollment is expected/acceptable**.

---

## Why this mode is acceptable locally

Benefits:
- uses an intended same-host backend integration path
- avoids borrowing the operator's own CLI device state
- keeps Wakery's device-signing material separate from CLI/Control UI
- works today for real session delivery
- avoids blocking local Wakery progress on extra pairing machinery

Tradeoffs:
- Wakery does not become a managed listed device
- no independent per-device token rotation/revoke lifecycle via `openclaw devices ...`
- still tied to the shared local gateway token for current auth

---

## Future managed-device mode

If Wakery later moves off-host, or if stricter operator governance is required, revisit the fully managed device path.

That future mode would aim for:
- pending/approved device lifecycle
- visible device entry in `openclaw devices list`
- dedicated per-device token issuance
- independent rotate/revoke lifecycle

That is still a valid hardening direction, but it is not a blocker for the current same-host deployment model.

---

## Current local runtime requirements

### Secrets

All secret values live in the keystore project at `<keystore>/` and are referenced by `_PATH` env vars:
- `WAKERY_DATABASE_PASSWORD_PATH` → `<keystore>/postgres/wakery-app.password`
- `WAKERY_GITHUB_WEBHOOK_SECRET_PATH` → `<keystore>/github/webhook_wakery`
- `WAKERY_GITHUB_TOKEN_PATH` → `<keystore>/github/owner.token`
- `WAKERY_OPENCLAW_GATEWAY_TOKEN_PATH` → `<keystore>/openclaw/gateway-token`

Non-secret database connection params (`WAKERY_DATABASE_HOST`, `_PORT`, `_USER`, `_NAME`) stay inline in `.env`.

### Local runtime state
- `WAKERY_OPENCLAW_DEVICE_DIR`
  - stores Wakery's own device identity/signing material
  - must stay outside git
  - must stay separate from the operator's own CLI auth state

---

## Verification status

Confirmed in live local testing:
- Wakery can connect to Gateway using corrected device-signing logic
- Wakery can send a real session-delivery smoke message to `agent:heimdall:main`
- Heimdall receives and replies normally
- no new listed device appears for that local backend path

That combination is now treated as the expected local same-host behavior.

---

## References

Official docs:
- Gateway overview: https://docs.openclaw.ai/gateway
- Gateway protocol: https://docs.openclaw.ai/gateway/protocol
- Gateway troubleshooting: https://docs.openclaw.ai/gateway/troubleshooting
- Devices CLI: https://docs.openclaw.ai/cli/devices

Related internal research:
- `docs/research/research_20260413_wakery-gateway-auth-modes/research.md`
