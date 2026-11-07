"use client";

import { useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export default function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    gsap.registerPlugin(ScrollTrigger);
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
              start: "top 88%",
              end: "bottom 12%",
              // Replay on either entry direction and reset only after the element
              // has moved fully out of view, so the next pass animates again.
              toggleActions: "play reset play reset",
            },
          });
        });
      });
      ScrollTrigger.refresh();
    });

    return () => context.revert();
  }, []);

  return null;
}
