// Element identities are maintained by the trusted browser adapter, not the model.
export async function observePage(page) {
  return page.evaluate(() => {
    const key = Symbol.for("2db.observation");
    const state = (window[key] ||= {
      ids: new WeakMap(),
      sequence: 0,
      page: crypto.randomUUID().slice(0, 8),
    });
    const nodes = [
      ...document.querySelectorAll("a,button,input,select,textarea"),
    ]
      .filter(
        (n) =>
          n.getClientRects().length &&
          getComputedStyle(n).visibility !== "hidden",
      )
      .slice(0, 100);
    // Remove any application-provided values before minting trusted unique refs.
    for (const n of document.querySelectorAll("[data-2db-ref]"))
      n.removeAttribute("data-2db-ref");
    const elements = nodes.map((n) => {
      if (!state.ids.has(n))
        state.ids.set(n, `${state.page}-${++state.sequence}`);
      const ref = state.ids.get(n);
      n.setAttribute("data-2db-ref", ref);
      return {
        selector: `[data-2db-ref="${ref}"]`,
        tag: n.tagName.toLowerCase(),
        text: (n.textContent || "").trim().slice(0, 120),
        label:
          n.getAttribute("aria-label") ||
          [...(n.labels || [])].map((l) => l.textContent.trim()).join(" "),
        href: n.getAttribute("href"),
        type: n.getAttribute("type"),
        disabled: Boolean(n.disabled),
        value: ["password", "hidden"].includes(n.type) ? undefined : n.value,
        options:
          n.tagName === "SELECT"
            ? [...n.options].map((o) => ({ value: o.value, text: o.text }))
            : undefined,
      };
    });
    return {
      url: location.href,
      text: document.body.innerText.slice(0, 7000),
      elements,
    };
  });
}
