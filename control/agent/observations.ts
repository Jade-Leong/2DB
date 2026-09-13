import { createHash } from "node:crypto";

// Full browser records remain on disk. Only changed, bounded observations enter the model.
export class ObservationContext {
  private previous = "";
  private unchanged = 0;
  browser(data: any, includeResponses = false) {
    const page = { url: data.url, text: data.text, elements: data.elements };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(page))
      .digest("hex");
    const same = fingerprint === this.previous;
    this.previous = fingerprint;
    this.unchanged = same ? this.unchanged + 1 : 0;
    const responses = (data.responses || []).slice(-5).map((r: any) => ({
      path: r.path,
      status: r.status,
      method: r.method,
      ...(includeResponses || /\/api\/(checkout|quote|orders)/.test(r.path)
        ? {
            body: JSON.stringify(r.body).slice(0, 2500),
          }
        : {}),
    }));
    return {
      ok: data.ok,
      error: data.error,
      ...(same
        ? {
            url: data.url,
            unchanged: true,
            note: "Page is unchanged. Reuse the previously returned exact selectors; choose a different action instead of inspecting again.",
          }
        : page),
      responses,
      receipt: data.receipt,
      evidence: data.evidence,
      repeatedObservationCount: this.unchanged,
    };
  }
}
