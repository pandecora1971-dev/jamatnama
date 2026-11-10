"use client";
import { useEffect } from "react";

/** Progressive enhancement: content stays visible without motion support. */
export default function MotionEnhancements() {
  useEffect(() => {
    const root = document.querySelector(".jwr-homepage");
    if (
      !root ||
      !window.IntersectionObserver ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const seen = new WeakSet<Element>();
    const selector =
      ".jwr-section-title, .jwr-card, .jwr-category-grid > button, .jwr-process article, .jwr-live-summary, .story-reveal";
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -20px 0px" },
    );
    function observe(scope: Element) {
      const nodes = [
        ...(scope.matches(selector) ? [scope] : []),
        ...scope.querySelectorAll(selector),
      ];
      nodes.forEach((node, index) => {
        if (seen.has(node)) return;
        seen.add(node);
        node.classList.add("motion-reveal");
        (node as HTMLElement).style.setProperty(
          "--reveal-delay",
          `${Math.min(index % 4, 3) * 45}ms`,
        );
        const bounds = node.getBoundingClientRect();
        if (bounds.top < window.innerHeight && bounds.bottom > 0)
          node.classList.add("is-visible");
        else observer.observe(node);
      });
    }
    root.classList.add("motion-ready");
    observe(root);
    const mutations = new MutationObserver((entries) => {
      for (const entry of entries)
        for (const node of entry.addedNodes)
          if (node instanceof Element) observe(node);
    });
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      root.classList.remove("motion-ready");
    };
  }, []);
  return null;
}
