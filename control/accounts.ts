import type { Express } from "express";
import { problem } from "./paths";

export type AccountIdentity = { reviewer: string; expiresIn: number; accessToken: string };
export interface AccountAuth {
  enabled: boolean;
  signup(email: string, password: string, redirect: string): Promise<void>;
  login(email: string, password: string): Promise<AccountIdentity>;
  logout(accessToken: string): Promise<void>;
}

// Supabase owns passwords and email verification. Its tokens stay on the server.
export function createAccountAuth(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): AccountAuth {
  const origin = env.SUPABASE_URL?.replace(/\/$/, "") || "";
  const key = env.SUPABASE_PUBLISHABLE_KEY || "";
  const enabled = !!(origin && key && env.LOOP_TEST !== "1");
  async function call(route: string, body?: object, accessToken?: string) {
    if (!enabled) problem("Account login is not configured yet. Local engineer access is available below.", 503);
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin))
      problem("Account login configuration is invalid.", 503);
    let response: Response;
    try {
      response = await request(`${origin}/auth/v1${route}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { apikey: key, "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch { problem("Account service could not be reached. Please try again.", 503); }
    const result = await response!.json().catch(() => ({}));
    if (!response!.ok) {
      if (response!.status === 429) problem("Too many attempts. Please wait before trying again.", 429);
      if (result.code === "email_not_confirmed" || result.error_code === "email_not_confirmed")
        problem("Confirm your email before logging in.", 401);
      if (route.startsWith("/signup")) problem("We could not create the account. Check your details or try logging in.", 400);
      problem("Email or password is incorrect, or the account is unavailable.", 401);
    }
    return result;
  }
  return {
    enabled,
    async signup(email, password, redirect) {
      await call(`/signup?redirect_to=${encodeURIComponent(redirect)}`, { email, password });
    },
    async login(email, password) {
      const session = await call("/token?grant_type=password", { email, password });
      if (typeof session.access_token !== "string") problem("Login did not return a valid session.", 401);
      // Fetch the authoritative user; never authorize from browser claims or user_metadata.
      const user = await call("/user", undefined, session.access_token);
      if (!user.id || !user.email || !user.email_confirmed_at || user.is_anonymous)
        problem("Confirm your email before logging in.", 401);
      const expiresIn = Math.min(Number(session.expires_in) || 0, 3600);
      if (expiresIn <= 0) problem("Your session expired. Please log in again.", 401);
      return { reviewer: `${user.email} (${user.id})`, expiresIn, accessToken: session.access_token };
    },
    async logout(accessToken) { await call("/logout?scope=local", {}, accessToken); },
  };
}

export function mountAccountRoutes(
  app: Express,
  auth: AccountAuth,
  issue: (identity: AccountIdentity) => string,
) {
  const attempts = new Map<string, { count: number; start: number }>();
  app.get("/auth-api/config", (_req, res) => res.json({ enabled: auth.enabled }));
  for (const mode of ["signup", "login"] as const) {
    app.post(`/auth-api/${mode}`, async (req, res) => {
      const now = Date.now();
      for (const [key, entry] of attempts) if (now - entry.start > 60_000) attempts.delete(key);
      const address = req.socket.remoteAddress || "local";
      const entry = attempts.get(address) || { count: 0, start: now };
      if (++entry.count > 10) problem("Too many attempts. Please wait one minute.", 429);
      attempts.set(address, entry);
      const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body.password === "string" ? req.body.password : "";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problem("Enter a valid email address.", 400);
      if (!password || password.length > 128 || (mode === "signup" && password.length < 12))
        problem(mode === "signup" ? "Use a password between 12 and 128 characters." : "Enter your password.", 400);
      if (mode === "signup") {
        // Origin is the controller's validated loopback origin, never a browser-supplied redirect.
        await auth.signup(email, password, `http://127.0.0.1:${req.socket.localPort}/?auth=login`);
        res.status(202).json({ message: "Check your email to confirm your account, then log in. If you already have an account, log in instead." });
      } else {
        const identity = await auth.login(email, password);
        res.json({ token: issue(identity), reviewer: identity.reviewer, expiresIn: identity.expiresIn });
      }
    });
  }
}
