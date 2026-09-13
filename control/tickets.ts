import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import { problem, now } from "./paths";

const accounts: Record<string, { name: string; role: "buyer" | "seller" }> = {
  "buyer-maya": { name: "Maya Chen", role: "buyer" },
  "buyer-jamie": { name: "Jamie Rivera", role: "buyer" },
  "seller-olive": { name: "Olive Brooks", role: "seller" },
  "seller-theo": { name: "Theo Park", role: "seller" },
};
export type TicketInput = { accountId: string; subject: string; complaint: string; source: "support-form" | "elevenlabs"; relatedReference?: string | null; requestId?: string };

export function createTicket(store: Store, input: TicketInput) {
  const account = accounts[input.accountId];
  if (!account) problem("Select a local demo account.", 401);
  if (!input.subject.trim() || input.subject.length > 150 || !input.complaint.trim() || input.complaint.length > 5000)
    problem("Enter a subject and message within the length limits.");
  const requestId = input.requestId?.trim();
  if (requestId) {
    const prior = store.db.prepare("SELECT ticket_id FROM ticket_requests WHERE request_id=?").get(requestId) as { ticket_id: string } | undefined;
    if (prior) return store.db.prepare("SELECT * FROM tickets WHERE id=?").get(prior.ticket_id);
  }
  const id = randomUUID(), submitted = now();
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.db.prepare("INSERT INTO tickets(id,customer_id,customer_name,customer_role,subject,complaint,submitted_at,related_reference,imported_at,source) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, input.accountId, account.name, account.role, input.subject.trim(), input.complaint.trim(), submitted, input.relatedReference?.trim() || null, submitted, input.source);
    if (requestId) store.db.prepare("INSERT INTO ticket_requests(request_id,ticket_id) VALUES(?,?)").run(requestId, id);
    store.db.prepare("INSERT INTO activity(ticket_id,proposal_id,actor,event,details,created_at) VALUES(?,?,?,?,?,?)")
      .run(id, null, input.source, "Ticket received", "Original complaint saved without diagnosis.", submitted);
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    if (requestId) {
      const prior = store.db.prepare("SELECT ticket_id FROM ticket_requests WHERE request_id=?").get(requestId) as { ticket_id: string } | undefined;
      if (prior) return store.db.prepare("SELECT * FROM tickets WHERE id=?").get(prior.ticket_id);
    }
    throw error;
  }
  return store.db.prepare("SELECT * FROM tickets WHERE id=?").get(id);
}
