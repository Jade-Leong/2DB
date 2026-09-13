(() => {
  const seen = new Set();
  const progress = new Map();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let blocks = [], frame = 0, last = 0;

  function reveal(block, count) {
    block.cursor?.classList.remove("is-cursor");
    for (; block.index < count; block.index++) block.chars[block.index].classList.add("is-visible");
    progress.set(block.key, block.index);
    block.cursor = block.chars[block.index - 1];
    if (block.index === block.chars.length) seen.add(block.key);
    else block.cursor?.classList.add("is-cursor");
  }

  function tick(time) {
    frame = 0;
    const steps = Math.max(1, Math.min(6, Math.floor((time - last) / 18)));
    if (time - last < 18) { frame = requestAnimationFrame(tick); return; }
    last = time;
    let typing = false;
    for (const block of blocks) {
      if (!block.el.isConnected || seen.has(block.key)) continue;
      const rect = block.el.getBoundingClientRect();
      // Each line fills as it travels from the lower viewport toward its center.
      const fraction = Math.max(0, Math.min(1, (innerHeight * .85 - rect.top) / (innerHeight * .3)));
      const target = Math.floor(block.chars.length * fraction);
      if (rect.bottom < 0) { reveal(block, block.chars.length); continue; }
      if (target <= block.index) continue;
      if (typing) continue;
      reveal(block, Math.min(target, block.index + steps));
      typing = true;
    }
    if (typing) frame = requestAnimationFrame(tick);
  }
  function schedule() {
    if (!frame && !motion.matches) { last = performance.now(); frame = requestAnimationFrame(tick); }
  }
  window.TerminalMotion = {
    enhance(root) {
      cancelAnimationFrame(frame); frame = 0; blocks = [];
      if (motion.matches) return;
      root.querySelectorAll("[data-type]").forEach(el => {
        const key = el.dataset.type;
        if (seen.has(key)) return;
        const accessible = document.createElement("span");
        accessible.className = "typing-accessible";
        accessible.textContent = el.innerText;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
          const wrapper = document.createElement("span"); wrapper.setAttribute("aria-hidden", "true");
          Array.from(node.nodeValue).forEach(text => {
            const char = document.createElement("span"); char.className = "typing-char"; char.textContent = text; wrapper.appendChild(char);
          });
          node.replaceWith(wrapper);
        });
        el.appendChild(accessible);
        const block = { el, key, chars: [...el.querySelectorAll(".typing-char")], index: 0, cursor: null };
        reveal(block, Math.min(progress.get(key) || 0, block.chars.length));
        blocks.push(block);
      });
      schedule();
    },
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  motion.addEventListener("change", event => {
    if (!event.matches) { schedule(); return; }
    cancelAnimationFrame(frame); frame = 0;
    blocks.forEach(block => reveal(block, block.chars.length));
  });
})();
