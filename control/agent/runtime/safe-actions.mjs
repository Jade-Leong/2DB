// This allowlist belongs to the trusted adapter, not the candidate or model.
export function safeRequest(method, url, origin) {
  const destination = new URL(url);
  return (
    destination.origin === origin &&
    (["GET", "HEAD"].includes(method) ||
      (method === "POST" && destination.pathname === "/api/quote"))
  );
}

export async function resolveElement(page, target, selectors) {
  let element;
  if (target.startsWith("label:"))
    element = page.getByLabel(target.slice(6), { exact: true });
  else if (target.startsWith("text:"))
    element = page
      .locator("a,button")
      .filter({
        hasText: new RegExp(
          "^" + target.slice(5).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
        ),
      });
  else {
    if (!selectors.has(target))
      throw new Error("Use a current trusted selector");
    element = page.locator(target);
  }
  if ((await element.count()) !== 1 || !(await element.isVisible()))
    throw new Error("Target must resolve to one visible control");
  return element;
}

export async function assertSafeElement(element, action, origin) {
  const node = await element.evaluate((n) => ({
    tag: n.tagName,
    type: n.type,
    text: n.textContent.trim(),
    href: n.href,
    form: Boolean(n.form),
    label: n.getAttribute("aria-label"),
  }));
  if (
    action === "fill" &&
    ["INPUT", "TEXTAREA"].includes(node.tag) &&
    !["file", "submit", "button", "image", "hidden", "password"].includes(
      node.type,
    )
  )
    return;
  if (
    action === "select" &&
    node.tag === "SELECT" &&
    node.label === "Local-only demo account"
  )
    return;
  if (
    action === "click" &&
    node.tag === "A" &&
    node.href &&
    new URL(node.href).origin === origin
  )
    return;
  if (
    action === "click" &&
    node.tag === "BUTTON" &&
    !node.form &&
    /^Add to bag(?: \u2014 \$\d+\.\d{2})?$/.test(node.text)
  )
    return;
  throw new Error("This control requires a separate explicit model decision");
}
