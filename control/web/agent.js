// Dashboard receives public run summaries and trusted evidence; never worker credentials.
let agentStatus = null,
  investigations = [],
  investigation = null;
async function refreshAgent() {
  [agentStatus, investigations] = await Promise.all([
    api("/agent/status"),
    api("/investigations"),
  ]);
  const t = selected?.ticket || ticket;
  const latest = investigations.find((r) => r.ticket_id === t?.id);
  investigation = latest ? await api("/investigations/" + latest.id) : null;
}
function agentView(t) {
  const run = investigation?.ticket_id === t?.id ? investigation : null;
  const running = investigations.some((r) => !r.finished_at);
  return `<section class="panel live-agent"><div class="section-title"><div><span class="eyebrow">AGENT 1 · LIVE INVESTIGATION</span><h2>Reproduce before proposing.</h2></div>${badge(agentStatus?.state || "Checking setup")}</div>
    <p class="muted">The model chooses actions in a fresh thread. Browser evidence gates source edits; your approval gates candidate execution.</p>
    <div class="setup-grid">${["sdk", "authentication", "browser", "isolation"].map((k) => `<div><strong>${esc(k === "sdk" ? "Codex SDK" : k)}</strong>${badge(agentStatus?.[k]?.ready ? "Ready" : "Setup required")}<p class="small muted">${esc(agentStatus?.[k]?.message || "Checking…")}</p></div>`).join("")}</div>
    <p class="small">Setup guide: <code>control/AGENT-1.md</code> · Check with <code>npm.cmd run control:agent:status</code>. Never put an API key in a ticket.</p>
    <div class="actions"><button data-action="investigate" data-id="${esc(t.id)}" ${running || busy || agentStatus?.state !== "Ready" ? "disabled" : ""}>Investigate with Agent 1</button><button class="secondary" data-action="refresh">Recheck setup</button>${run && !run.finished_at ? `<button class="danger" data-action="cancel-investigation" data-id="${esc(run.id)}">Cancel investigation</button>` : ""}</div>
    ${
      run
        ? `<div class="run-message">${badge(run.state)}<p>${esc(run.message)}</p><small>${date(run.started_at)} → ${date(run.finished_at)} · Run ${esc(run.id)}<br>Thread: ${esc(run.thread_id || "Not started")}</small></div>
    ${run.proposal_id ? `<button data-action="proposal" data-id="${esc(run.proposal_id)}">Review agent-generated proposal →</button>` : ""}
    <details ${!run.finished_at ? "open" : ""}><summary>Actual investigation actions</summary><ol class="timeline">${run.events.map((e) => `<li><span class="dot"></span><div><strong>${esc(e.state)}</strong><p>${esc(e.message)}</p>${e.details ? `<pre>${esc(JSON.stringify(e.details, null, 2))}</pre>` : ""}<small>${date(e.at)}</small></div></li>`).join("")}</ol></details>
    <details><summary>Trusted browser evidence (${run.evidence.length})</summary>${run.evidence.map((e) => `<p class="small">${date(e.at)} ${e.orderId ? `· Order ${esc(e.orderId)} · displayed ${esc(e.displayedCents)} / order ${esc(e.orderCents)} / payment ${esc(e.paymentCents)} cents` : ""}<br><button class="text" data-artifact="/investigations/${run.id}/evidence/${e.screenshot}">Screenshot</button><button class="text" data-artifact="/investigations/${run.id}/evidence/${e.record}">Observed values and responses</button></p>`).join("")}</details>
    <details><summary>Reported token usage · no estimated dollar cost</summary><pre>${esc(JSON.stringify(run.usage, null, 2))}</pre></details>`
        : ""
    }
    ${
      investigations.filter((r) => r.ticket_id === t.id && r.id !== run?.id)
        .length
        ? `<details><summary>Earlier investigations</summary>${investigations
            .filter((r) => r.ticket_id === t.id && r.id !== run?.id)
            .map(
              (r) =>
                `<p>${esc(r.state)} · ${date(r.started_at)} <button class="text" data-artifact="/investigations/${r.id}">Run record</button></p>`,
            )
            .join("")}</details>`
        : ""
    }
  </section>`;
}
