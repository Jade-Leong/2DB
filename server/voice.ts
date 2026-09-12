import { Router, type Request } from "express";

type Options = {
  account: (req: Request) => { id: string };
  configuration?: () => { apiKey?: string; agentId?: string };
  request?: typeof fetch;
};
export function voiceRouter({
  account,
  configuration = () => ({
    apiKey: process.env.ELEVENLABS_API_KEY,
    agentId: process.env.ELEVENLABS_AGENT_ID,
  }),
  request = fetch,
}: Options) {
  const router = Router();
  const recent = new Map<string, number>();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/status", (req, res) => {
    account(req);
    const { apiKey, agentId } = configuration();
    res.json({ available: Boolean(apiKey?.trim() && agentId?.trim()) });
  });
  router.post("/session", async (req, res) => {
    const user = account(req);
    const origin = req.get("origin");
    if (origin) {
      const allowed = [
        `http://${req.get("host")}`,
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ];
      if (!allowed.includes(origin)) {
        res
          .status(403)
          .json({ error: "Start voice support from this marketplace." });
        return;
      }
    }
    const { apiKey, agentId } = configuration();
    if (!apiKey?.trim() || !agentId?.trim()) {
      res
        .status(503)
        .json({
          error:
            "Voice support isn’t available yet. You can still fill out a form.",
        });
      return;
    }
    if (Date.now() - (recent.get(user.id) ?? 0) < 10_000) {
      res
        .status(429)
        .json({
          error:
            "Please wait a few seconds before starting another conversation.",
        });
      return;
    }
    recent.set(user.id, Date.now());
    try {
      const url = new URL(
        "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
      );
      url.searchParams.set("agent_id", agentId);
      const response = await request(url, {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Voice provider unavailable");
      const data = (await response.json()) as { signed_url?: unknown };
      if (typeof data.signed_url !== "string")
        throw new Error("Invalid session");
      const signed = new URL(data.signed_url);
      if (signed.protocol !== "wss:" || signed.hostname !== "api.elevenlabs.io")
        throw new Error("Invalid session host");
      res.json({ signedUrl: data.signed_url });
    } catch {
      // Never log provider bodies, signed URLs, or credentials.
      res
        .status(502)
        .json({
          error:
            "We couldn’t connect to voice support. Try again shortly or use the form.",
        });
    }
  });
  return router;
}
