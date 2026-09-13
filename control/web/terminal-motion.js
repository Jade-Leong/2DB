(() => {
  const seen = new Set();
  const progress = new Map();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let observer, frame = 0;
  const jobs = new Set();
  function finish(job) {
    job.chars.forEach(char => char.classList.add("is-visible"));
    job.cursor?.classList.remove("is-cursor");
    seen.add(job.element.dataset.type);
    progress.delete(job.element.dataset.type);
    jobs.delete(job);
  }
  function tick(time) {
    const activeGroups = new Set();
    for (const job of jobs) {
      if (!job.element.isConnected) { jobs.delete(job); continue; }
      if (activeGroups.has(job.group)) continue;
      activeGroups.add(job.group);
      if (!job.start) job.start = time;
      const next = Math.min(job.chars.length, job.offset + Math.floor((time - job.start) / job.interval) + 1);
      job.cursor?.classList.remove("is-cursor");
      for (; job.index < next; job.index++) job.chars[job.index].classList.add("is-visible");
      progress.set(job.element.dataset.type, job.index);
      job.cursor = job.chars[next - 1];
      job.cursor?.classList.add("is-cursor");
      if (next === job.chars.length) seen.add(job.element.dataset.type);
      if (next === job.chars.length && time - job.start > (job.chars.length - job.offset) * job.interval + 180) finish(job);
    }
    frame = jobs.size ? requestAnimationFrame(tick) : 0;
  }
  window.TerminalMotion = {
    enhance(root) {
      observer?.disconnect(); cancelAnimationFrame(frame); frame = 0;
      jobs.clear();
      if (motion.matches || !("IntersectionObserver" in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          observer.unobserve(el);
          const chars = [...el.querySelectorAll(".typing-char")];
          const offset = progress.get(el.dataset.type) || 0;
          jobs.add({ element: el, chars, index: offset, offset, start: 0, interval: 24, cursor: null, group: el.closest("article, section") || el });
        });
        if (jobs.size && !frame) frame = requestAnimationFrame(tick);
      }, { threshold: .15, rootMargin: "0px 0px -48px 0px" });
      root.querySelectorAll("[data-type]").forEach(el => {
        if (seen.has(el.dataset.type)) return;
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
        [...el.querySelectorAll(".typing-char")].slice(0, progress.get(el.dataset.type) || 0).forEach(char => char.classList.add("is-visible"));
        observer.observe(el);
      });
    },
  };
  motion.addEventListener("change", event => {
    if (!event.matches) return;
    observer?.disconnect(); cancelAnimationFrame(frame); frame = 0;
    for (const job of jobs) finish(job);
    document.querySelectorAll(".typing-char").forEach(char => char.classList.add("is-visible"));
    document.querySelectorAll("[data-type]").forEach(el => seen.add(el.dataset.type));
  });
})();
