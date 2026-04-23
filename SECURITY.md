# Security overview

This document describes what the PD Scope server protects against, what it relies on the operator to do, and what it does **not** yet cover. Read it before going live.

## Threat model

The starter is designed to protect against:

- **Credential stuffing and brute force** — `express-rate-limit` caps login attempts at 5 per 15 minutes per IP. Password hashes use bcrypt with cost factor 12 (~250ms per verification), making offline cracking expensive.
- **Session theft via XSS** — the session cookie is `HttpOnly`, so JavaScript running in the browser cannot read it. An XSS bug would still let an attacker *act* as the user while the page is open, but they could not exfiltrate the token.
- **Session theft via network sniffing** — in production, `Secure: true` means the cookie is only sent over HTTPS. Hosting on Render/GitHub Pages gives you HTTPS automatically.
- **SQL injection** — every query uses parameterised placeholders (`$1`, `$2`) via `node-postgres`. No user input is concatenated into SQL anywhere.
- **Unauthorized access** — every non-public route requires a valid session, and admin-only routes additionally require `role = 'admin'`. Ownership checks (`WHERE user_id = $current_user`) appear on every assessment query.
- **Stale access** — sessions slide by 7 days on use but cap at 30 days from creation. Users with an `access_expires_at` in the past cannot log in or use existing sessions. Admins can revoke every session for a user instantly.
- **Password disclosure from server memory** — passwords are only held in memory during a single login request, then discarded; only the bcrypt hash is persisted. Logs are configured with `pino-http` to redact the `Cookie` and `Authorization` headers.
- **Database token disclosure** — what's stored in `sessions.token_hash` is the SHA-256 of the raw token. Even a read-only DB breach does not let the attacker impersonate a user, because they would need the pre-image.

## Assumptions the starter makes

- You run the backend on HTTPS in production. `Secure` cookies do not work over plain HTTP.
- `SESSION_SECRET` is unique per environment and kept out of source control.
- Only trusted people have the admin role. Admins can create users and revoke sessions for anyone.
- The database is reachable only from the backend (Render's managed Postgres enforces this by default with internal URLs).

## What this starter does NOT cover yet

The following are worth adding before you treat this as production-critical. None are hard — they're just not in v1:

- **Email verification on sign-up** — anyone an admin invites could, in theory, mistype their email. Adding a confirmation link prevents that.
- **Self-service password reset** — currently an admin must reset passwords via the API. A "forgot password" flow with a time-limited emailed token is the standard fix.
- **Two-factor authentication** — TOTP (Google Authenticator etc.) adds a second factor. Consider requiring it for admin accounts first.
- **Audit logging** — there is no record of "admin X revoked user Y at time T". Add an `audit_events` table and log admin actions.
- **CSRF protection** — because cookies are `SameSite=Lax` and the API is cross-origin with CORS credentials, most CSRF vectors are already blocked. If you later move the frontend to the same origin as the backend and relax CORS, add a CSRF token.
- **DDoS / abuse protection** — rate limiting covers `/login`. For everything else, rely on Render/Cloudflare in front of the app.
- **Content Security Policy tightening** — `helmet` applies conservative defaults. The app.html uses inline styles and scripts from the original tool, which means the default CSP is not as strict as it could be. Tightening this takes a dedicated pass.
- **Session inactivity logout** — sessions currently slide on every use. Some organisations require a forced logout after N minutes of inactivity. Easy to add by comparing `last_used_at` in the middleware.
- **Backups** — Render Postgres has automatic daily backups on paid tiers only. On free tier, export manually.

## If you suspect compromise

1. Log in as admin, open the Admin page, and hit **Deactivate** on the suspect account. This kills all their sessions and blocks login.
2. Rotate `SESSION_SECRET` in Render (this invalidates every session for every user — they all have to log in again).
3. Review recent assessments for unexpected changes; restore from DB backup if needed.
4. Rotate the affected user's password via `PATCH /admin/users/:id`.
