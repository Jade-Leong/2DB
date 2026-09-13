(() => {
  const seen = new Set();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let observer, frame = 0;
  const jobs = new Set();
  function finish(job) {
    job.chars.forEach(char => char.classList.add("is-visible"));
    job.cursor?.classList.remove("is-cursor");
    jobs.delete(job);
  }
  function tick(time) {
    for (const job of jobs) {
      if (!job.element.isConnected) { jobs.delete(job); continue; }
      if (!job.start) job.start = time;
      const next = Math.min(job.chars.length, Math.floor((time - job.start) / job.interval) + 1);
      job.cursor?.classList.remove("is-cursor");
      for (; job.index < next; job.index++) job.chars[job.index].classList.add("is-visible");
      job.cursor = job.chars[next - 1];
      job.cursor?.classList.add("is-cursor");
      if (next === job.chars.length && time - job.start > job.chars.length * job.interval + 250) finish(job);
    }
    frame = jobs.size ? requestAnimationFrame(tick) : 0;
  }
  window.TerminalMotion = {
    enhance(root) {
      observer?.disconnect(); cancelAnimationFrame(frame); frame = 0;
      for (const job of jobs) finish(job);
      if (motion.matches || !("IntersectionObserver" in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          observer.unobserve(el);
          seen.add(el.dataset.type);
          const chars = [...el.querySelectorAll(".typing-char")];
          jobs.add({ element: el, chars, index: 0, start: 0, interval: Math.max(8, Math.min(23, 1900 / chars.length)), cursor: null });
        });
        if (jobs.size && !frame) frame = requestAnimationFrame(tick);
      }, { threshold: .15, rootMargin: "0px 0px -12px 0px" });
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
