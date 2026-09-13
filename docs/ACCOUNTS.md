# 2db account access

The engineer workspace now includes email/password login and sign-up backed by the existing Supabase project. Anyone with a confirmed account can access the same shared tickets, proposals, and review actions. This is intentionally an open shared workspace, not a separate workspace per user.

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the private `.env` and restart the controller. Use the publishable key; no service-role key is required. In Supabase Authentication URL Configuration, add the controller's login URL (for example, `http://127.0.0.1:3002/?auth=login`) to the redirect allowlist. Include the actual port if running another local controller. Keep email confirmation enabled. Supabase's email provider must permit delivery to the addresses signing up; configure custom SMTP when opening registration beyond your Supabase project team.

The browser sends credentials to the same-origin controller, which forwards them to Supabase over HTTPS. Passwords are not stored by 2db. Login verifies the provider's authoritative user endpoint and exchanges its result for a random controller session held in sessionStorage. Provider access and refresh tokens are never returned to the browser. Controller account sessions last at most one hour and expire when the controller restarts. Sign-out immediately removes the controller session and attempts to revoke the provider session. An upstream revocation is not checked continuously during the already-issued controller session.

Review attribution records the verified email and Supabase user ID. Account access does not automatically approve proposals: exact-revision approval, isolation requirements, and the existing verification gates still apply. The existing local engineer key flow remains available as a fallback and retains its original authorization behavior.

Signup displays the confirmation-email state and returns to login. If a confirmation link returns to this page with provider tokens in its fragment, the page removes those tokens and asks for normal password login. If the Supabase service or email delivery is unavailable, the UI reports the error instead of simulating an account.

The visual implementation lives in `control/web/`: `terminal.css` layers the Terminal theme over the existing components; `terminal-motion.js` adds one-time scroll typing to introduction copy; `account.js` supplies the login/sign-up views. All original ticket and proposal actions continue to use the existing controller API. The logo is a plain text wordmark ready for replacement.

Validation: `node --import tsx --test --test-concurrency=1 control/tests/accounts.test.ts` uses an isolated controller and a synthetic Supabase provider to exercise signup, email confirmation, login, logout, authorization, mobile layout, typography, and scroll typing. It never creates a real Supabase account or sends email. Live settings can be checked without creating accounts via the provider's `/auth/v1/settings` endpoint. Real confirmation-email delivery requires a signup with a real user email.

Reference: [Supabase password-based Auth](https://supabase.com/docs/guides/auth/passwords).
