import { useEffect, useRef, useState } from "react";
import type { TicketDraft, VoiceSession } from "./voice-client";

type Turn = { role: "user" | "agent"; message: string };
const emptyDraft = { subject: "", message: "" };
export function Support({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const [mode, setMode] = useState<"form" | "voice" | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "ended"
  >("idle");
  const [speaking, setSpeaking] = useState(false),
    [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]),
    [draft, setDraft] = useState<TicketDraft>(emptyDraft);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const active = useRef<VoiceSession | null>(null),
    attempt = useRef(0);
  const pending = useRef<AbortController | null>(null),
    alive = useRef(true),
    submitting = useRef(false);
  const transcript = useRef<Turn[]>([]);
  const ticketRequestId = useRef(crypto.randomUUID());
  const connected = status === "connected",
    running = connected || status === "connecting";

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const externalBase = import.meta.env.VITE_TWO_DB_API_BASE_URL?.trim();
    const isTicketSubmit = path === "" && options.method === "POST";
    const response = await fetch(isTicketSubmit && externalBase ? `${externalBase.replace(/\/$/, "")}/api/support` : `/api/support${path}`, {
      ...options,
      headers: {
        "X-Demo-Account": accountId,
        ...(isTicketSubmit ? { "X-Support-Source": mode === "voice" ? "elevenlabs" : "support-form", "Idempotency-Key": ticketRequestId.current } : {}),
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "We couldn’t save your complaint. Please try again.",
      );
    return data;
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    request<{ available: boolean }>("/voice/status", {
      signal: controller.signal,
    })
      .then((data) => {
        if (alive.current) setAvailable(data.available);
      })
      .catch(() => {
        if (alive.current) setAvailable(false);
      });
    return () => {
      alive.current = false;
      attempt.current++;
      controller.abort();
      pending.current?.abort();
      const session = active.current;
      active.current = null;
      void session?.endSession().catch(() => {});
    };
  }, []);

  function useTranscript() {
    const words = transcript.current
      .filter((t) => t.role === "user")
      .map((t) => t.message)
      .join("\n\n");
    if (words)
      setDraft((previous) =>
        previous.message
          ? previous
          : {
              subject:
                previous.subject || "Help with my Loop Market experience",
              message: words,
            },
      );
  }
  function stop() {
    attempt.current++;
    pending.current?.abort();
    const session = active.current;
    active.current = null;
    void session?.endSession().catch(() => {});
    if (alive.current) {
      setStatus("ended");
      setMuted(false);
      setSpeaking(false);
      useTranscript();
    }
  }
  function choose(next: "form" | "voice") {
    if (next !== mode) stop();
    setMode(next);
    setError("");
    setNotice("");
  }
  async function start() {
    if (active.current || pending.current || !available) return;
    const id = ++attempt.current;
    const controller = new AbortController();
    pending.current = controller;
    const current = () => alive.current && attempt.current === id;
    setError("");
    setNotice("");
    setStatus("connecting");
    setMuted(false);
    setDraft(emptyDraft);
    setTurns([]);
    transcript.current = [];
    try {
      const { signedUrl } = await request<{ signedUrl: string }>(
        "/voice/session",
        { method: "POST", signal: controller.signal },
      );
      if (!current()) return;
      const { startVoiceSession } = await import("./voice-client");
      if (!current()) return;
      const session = await startVoiceSession(signedUrl, {
        onMessage(role, message) {
          if (!current()) return;
          transcript.current = [...transcript.current, { role, message }];
          setTurns(transcript.current);
        },
        onMode(value) {
          if (current()) setSpeaking(value);
        },
        onDraft(value) {
          if (current()) setDraft(value);
        },
        onDisconnect() {
          if (current()) stop();
        },
        onError() {
          if (!current()) return;
          stop();
          setError(
            "The conversation was interrupted. You can review what we captured or use the form.",
          );
        },
      });
      if (!current()) {
        await session.endSession();
        return;
      }
      active.current = session;
      setStatus("connected");
    } catch (e) {
      if (!current()) return;
      stop();
      const denied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "PermissionDeniedError");
      setError(
        denied
          ? "Microphone access was denied. Allow it in your browser and try again, or use the form."
          : "We couldn’t start the conversation. Check microphone access and try again, or fill out the form.",
      );
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  const review =
    mode === "form" ||
    (mode === "voice" &&
      !running &&
      (turns.length > 0 || draft.message.length > 0));
  return (
    <section className="support-page">
      <div className="page-heading">
        <p className="eyebrow">A LITTLE HELP, YOUR WAY</p>
        <h1>Let’s sort it out.</h1>
        <p>How would you like to tell us what happened?</p>
      </div>
      <div
        className="support-choices"
        aria-label="Choose how to contact support"
      >
        <button
          type="button"
          className="support-choice"
          aria-pressed={mode === "form"}
          onClick={() => choose("form")}
          disabled={saving}
        >
          <span className="support-choice-icon" aria-hidden="true">
            ✎
          </span>
          <span>
            <strong>Fill out a form</strong>
            <small>Write it down, at your own pace.</small>
          </span>
          <span aria-hidden="true">↗</span>
        </button>
        <button
          type="button"
          className="support-choice"
          aria-pressed={mode === "voice"}
          onClick={() => choose("voice")}
          disabled={saving}
        >
          <span className="support-choice-icon" aria-hidden="true">
            ◉
          </span>
          <span>
            <strong>Talk it through</strong>
            <small>A conversation with our AI support assistant.</small>
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      {error && (
        <p className="alert support-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {mode === "voice" && (
        <div className="panel voice-panel">
          <div className="voice-heading">
            <div
              className={`voice-orb ${connected && !muted ? "is-active" : ""}`}
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div>
              <p className="eyebrow">LOOP SUPPORT · POWERED BY ELEVENLABS</p>
              <h2>
                {connected
                  ? muted
                    ? "Microphone muted"
                    : speaking
                      ? "Your assistant is speaking"
                      : "We’re listening"
                  : status === "connecting"
                    ? "Connecting…"
                    : turns.length
                      ? "Thanks for talking it through."
                      : "A friendly ear for your problem."}
              </h2>
              <p aria-live="polite">
                {running
                  ? "You can end the conversation at any time."
                  : "Tell us what happened. We’ll help you put it into words."}
              </p>
            </div>
          </div>
          <p className="small muted">
            Starting a conversation shares your microphone audio with
            ElevenLabs. A transcript appears here so you can review your
            complaint before submitting. Please use fictional information in
            this demo.
          </p>
          {available === false && (
            <p className="alert">
              Voice support isn’t available yet. You can still{" "}
              <button className="text-button" onClick={() => choose("form")}>
                fill out a form
              </button>
              .
            </p>
          )}
          <div className="voice-actions">
            {!running && (
              <button onClick={start} disabled={!available || saving}>
                {available === null
                  ? "Checking voice availability…"
                  : turns.length
                    ? "Start another conversation"
                    : "Start conversation"}
              </button>
            )}
            {connected && (
              <button
                className="secondary-button"
                onClick={() => {
                  active.current?.setMicMuted(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? "Unmute microphone" : "Mute microphone"}
              </button>
            )}
            {running && (
              <button onClick={stop}>
                {connected ? "End & review complaint" : "Cancel connection"}
              </button>
            )}
            <button
              className="text-button"
              onClick={() => choose("form")}
              disabled={saving}
            >
              Use the form instead
            </button>
          </div>
          {turns.length > 0 && (
            <div
              className="voice-transcript"
              role="log"
              aria-label="Conversation transcript"
              aria-live="polite"
            >
              {turns.map((turn, i) => (
                <p key={i} className={`voice-turn ${turn.role}`}>
                  <strong>
                    {turn.role === "user" ? "You" : "Loop assistant"}
                  </strong>
                  <span>{turn.message}</span>
                </p>
              ))}
            </div>
          )}
          {running && draft.message && (
            <p className="small">
              Your complaint draft is ready. End the conversation to review and
              submit it.
            </p>
          )}
        </div>
      )}
      {review && (
        <form
          className="panel support-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting.current || running) return;
            submitting.current = true;
            setSaving(true);
            setError("");
            setNotice("");
            try {
              const result = await request<{ id: string }>("", {
                method: "POST",
                body: JSON.stringify(draft),
              });
              if (!alive.current) return;
              setNotice(`Support ticket saved. Reference: ${result.id}`);
              setDraft(emptyDraft);
              ticketRequestId.current = crypto.randomUUID();
              setTurns([]);
              transcript.current = [];
              setMode("form");
            } catch (e) {
              if (alive.current) setError((e as Error).message);
            } finally {
              submitting.current = false;
              if (alive.current) setSaving(false);
            }
          }}
        >
          <h2>
            {mode === "voice"
              ? "Review your complaint"
              : "Tell us what happened"}
          </h2>
          <p className="muted">Submitting as {accountName}</p>
          {mode === "voice" && (
            <p className="small muted">
              Check the details and make any changes. Nothing is submitted until
              you choose Submit complaint.
            </p>
          )}
          <label>
            Subject
            <input
              name="subject"
              required
              maxLength={150}
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="What can we help with?"
              disabled={saving}
            />
          </label>
          <label>
            What happened?
            <textarea
              name="message"
              required
              maxLength={5000}
              rows={6}
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              placeholder="Include your order reference or listing name if you have one."
              disabled={saving}
            />
          </label>
          {draft.message.length > 5000 && (
            <p role="alert">
              Please shorten your complaint to 5,000 characters before
              submitting.
            </p>
          )}
          <p className="small muted">
            Your complaint is saved locally for review in 2DB. This demo does
            not contact a support team.
          </p>
          <button disabled={saving || draft.message.length > 5000}>
            {saving ? "Saving…" : "Submit complaint"}
          </button>
        </form>
      )}
    </section>
  );
}
