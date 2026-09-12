import { Conversation } from "@elevenlabs/client";
export type TicketDraft = { subject: string; message: string };
export type VoiceSession = {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
};
export type VoiceCallbacks = {
  onMessage(role: "user" | "agent", message: string): void;
  onMode(speaking: boolean): void;
  onDisconnect(): void;
  onError(): void;
  onDraft(draft: TicketDraft): void;
};
export async function startVoiceSession(
  signedUrl: string,
  callbacks: VoiceCallbacks,
): Promise<VoiceSession> {
  return Conversation.startSession({
    signedUrl,
    connectionType: "websocket",
    onMessage: ({ role, message }) => callbacks.onMessage(role, message),
    onModeChange: ({ mode }) => callbacks.onMode(mode === "speaking"),
    onDisconnect: () => callbacks.onDisconnect(),
    onError: () => callbacks.onError(),
    clientTools: {
      prepare_support_ticket: (input: unknown) => {
        const draft = input as Partial<TicketDraft> | null;
        if (
          !draft ||
          typeof draft.subject !== "string" ||
          !draft.subject.trim() ||
          draft.subject.length > 150 ||
          typeof draft.message !== "string" ||
          !draft.message.trim() ||
          draft.message.length > 5000
        ) {
          return "Draft rejected. Provide a subject of 1–150 characters and a message of 1–5000 characters.";
        }
        callbacks.onDraft({
          subject: draft.subject.trim(),
          message: draft.message.trim(),
        });
        return "Draft prepared for the customer to review on screen. It has NOT been submitted. Ask them to end the call and click Submit complaint when ready.";
      },
    },
  });
}
