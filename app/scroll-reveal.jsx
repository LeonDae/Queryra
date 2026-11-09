"use client";

import { useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export default function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    gsap.registerPlugin(ScrollTrigger);
    let refreshFrame = null;
    const scheduleRefresh = () => {
      if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = null;
        ScrollTrigger.refresh();
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRefresh);
    document.querySelectorAll(".web-composer-panel").forEach((panel) => resizeObserver?.observe(panel));

    const context = gsap.context(() => {
      document.querySelectorAll(".marketing-site, .docs-page, .resources-page").forEach((page) => {
        const hero = page.querySelector(".hero-copy");
        if (hero) gsap.fromTo(hero.children, { autoAlpha: 0, y: 30, filter: "blur(8px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 1, stagger: .13, ease: "power3.out", delay: .12 });
        page.querySelectorAll("main > section:not(.hero-section) .section-kicker, main > section:not(.hero-section) h2, .web-composer-heading, .pathway-card, .usecase-card, .product-walkthrough-row, .quickstart-panel, .faq-item, .docs-content section, .resource-card, .resource-bottom").forEach((element, index) => {
          gsap.fromTo(element, { autoAlpha: 0, y: 30, filter: "blur(5px)" }, {
            autoAlpha: 1,
            y: 0,
            filter: "blur(0px)",
            duration: .8,
            delay: (index % 3) * .06,
            ease: "power3.out",
            overwrite: "auto",
            scrollTrigger: {
              trigger: element,
              start: "top 85%",
              end: "bottom 15%",
              // Reverse on exit so each viewport entrance can replay in both directions.
              toggleActions: "play reverse play reverse",
            },
          });
        });
      });
      ScrollTrigger.refresh();
    });

    return () => {
      if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
      resizeObserver?.disconnect();
      context.revert();
    };
  }, []);

  return null;
}
