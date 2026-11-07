"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Brand from "./brand.jsx";
import { useCases } from "./use-case-data.js";
import QueryraWebComposer from "./queryra-web-composer.jsx";
import ScrollReveal from "./scroll-reveal.jsx";
import { updatePointerGradient } from "./pointer-gradient.js";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const installCommand = "npm install -g queryra-cli";
const resourceLinks = [["Get Your Own Data Set","kaggle","kaggle.png"],["Start Your Stock Analysis","tradingview","tradingview-light.png"],["Get Your API Key","google-ai-studio","google-gemini.png"],["Setup Local Language Model","ollama","ollama.png"]];
const questions = [
  ["What is Queryra?", "Queryra gives you two ways to explore data: Queryra CLI for a terminal-based local CSV workflow, and Queryra Web for an authenticated browser workspace."],
  ["Which data sources are supported?", "Queryra CLI supports local CSV files. Queryra Web accepts CSV files and .xlsx workbooks with worksheet selection; legacy .xls files are not supported."],
  ["Do I need a Gemini API key?", "Yes, for natural-language SQL generation. Bring your own Gemini API key; it stays in your local Queryra configuration or environment."],
  ["Where does query execution happen?", "The CLI runs DuckDB locally against your selected CSV. Queryra Web stores uploaded rows in the signed-in workspace's configured analytical database and runs queries through the web backend."],
  ["How do I get started?", "For the CLI, install queryra-cli, run queryra init, then use queryra schema and queryra ask. For Queryra Web, open the browser workspace and sign in if prompted."],
];

function Arrow({ diagonal = false }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="site-arrow"><path d={diagonal ? "M5 15 15 5M6 5h9v9" : "M3 10h13m-5-5 5 5-5 5"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return <button className="copy-command" onClick={copy} type="button" aria-label="Copy install command">{copied ? "Copied" : "Copy"}<span aria-hidden="true">{copied ? "✓" : "⌘"}</span></button>;
}

function ProductVideo() {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    video.play().catch(() => {});
  }, []);

  return <div className="hero-video-frame">
    <video ref={videoRef} className="hero-demo-video" src="/queryra-demo-website.mp4" autoPlay muted loop playsInline preload="metadata" aria-label="Queryra product demo" />
  </div>;
}

function WalkthroughVideo({ src, label }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const playWhenVisible = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      });
    };

    if (!("IntersectionObserver" in window)) {
      video.play().catch(() => {});
      return undefined;
    }

    const observer = new IntersectionObserver(playWhenVisible, { threshold: 0.25 });
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, []);

  return <div className="product-walkthrough-visual">
    <video ref={videoRef} src={src} muted loop playsInline preload="metadata" aria-label={label} />
  </div>;
}

function TimeSavingsStory() {
  const sectionRef = useRef(null);
  const imageRef = useRef(null);
  const firstLineRef = useRef(null);
  const secondLineRef = useRef(null);
  const thirdLineRef = useRef(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    gsap.registerPlugin(ScrollTrigger);

    const context = gsap.context(() => {
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          pin: true,
          pinSpacing: true,
          start: "top top",
          end: "+=1700",
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      // Opposite horizontal sliding tracks inspired by Nebula reference
      // With left: 50% in CSS, xPercent: -50 is centered horizontally.
      timeline.fromTo(firstLineRef.current, { xPercent: -18 }, { xPercent: -82, ease: "none" }, 0);
      timeline.fromTo(secondLineRef.current, { xPercent: -82 }, { xPercent: -18, ease: "none" }, 0);
      timeline.fromTo(thirdLineRef.current, { xPercent: -20 }, { xPercent: -80, ease: "none" }, 0);

      // Centered floating card with parallax vertical float, subtle tilt, and scale expansion
      timeline.fromTo(
        imageRef.current,
        { xPercent: -50, yPercent: -50, y: 75, scale: 0.93, rotate: -2.5 },
        { xPercent: -50, yPercent: -50, y: -75, scale: 1.07, rotate: 2, ease: "none" },
        0
      );

      // Ambient backlight glow growth and vertical sync
      const glow = section.querySelector(".story-image-glow");
      if (glow) {
        timeline.fromTo(
          glow,
          { scale: 0.8, opacity: 0.35, y: 60 },
          { scale: 1.3, opacity: 0.85, y: -60, ease: "none" },
          0
        );
      }
    }, section);

    const refreshTimer = setTimeout(() => {
      ScrollTrigger.refresh();
    }, 150);

    return () => {
      clearTimeout(refreshTimer);
      context.revert();
    };
  }, []);

  return (
    <section className="time-story" id="workflow" ref={sectionRef}>
      <div className="time-story-stage">
        <div className="story-image-glow" aria-hidden="true" />
        <div className="story-type-line story-type-line-one" ref={firstLineRef} aria-hidden="true">
          LESS BUSYWORK
        </div>
        <div className="story-image-frame" ref={imageRef}>
          <Image
            src="/magicpattern.webp"
            alt="Queryra architectural data patterns"
            fill
            priority={false}
            sizes="(max-width: 760px) 78vw, 460px"
          />
        </div>
        <div className="story-type-line story-type-line-two" ref={secondLineRef} aria-hidden="true">
          DATA TO DECISIONS
        </div>
        <div className="story-type-line story-type-line-three" ref={thirdLineRef} aria-hidden="true">
          MORE MOMENTUM
        </div>
      </div>
    </section>
  );
}

export default function MarketingSite() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const updateFinalGradient = (event) => updatePointerGradient(event.currentTarget, event, "--cta-x", "--cta-y");
  return <div className="marketing-site">
    <header className="site-header"><nav className="site-nav" aria-label="Main navigation">
      <Brand />
      <button className="mobile-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="site-menu" onClick={() => setMenuOpen(!menuOpen)}><span /><span /><span /><span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span></button>
      <div className={`site-menu${menuOpen ? " is-open" : ""}`} id="site-menu">
        <div className="site-links"><a href="#how-it-works" onClick={closeMenu}>How it works</a><details className="nav-dropdown"><summary>Use cases <span aria-hidden="true" /></summary><div className="nav-dropdown-menu">{useCases.map((item) => <Link key={item.slug} href={`/use-cases/${item.slug}`} onClick={closeMenu}>{item.cardTitle}</Link>)}</div></details><Link href="/docs" onClick={closeMenu}>CLI</Link><Link href="/workspace" onClick={closeMenu}>Queryra Web</Link><details className="nav-dropdown resource-nav-dropdown"><summary>Resources <span aria-hidden="true" /></summary><div className="nav-dropdown-menu">{resourceLinks.map(([name, slug, icon]) => <Link className="resource-nav-link" key={slug} href={`/resources#${slug}`} onClick={closeMenu}><img src={`/resources-icons/${icon}`} alt="" />{name}<span aria-hidden="true">↗</span></Link>)}</div></details></div>
        <div className="nav-actions"><Link className="nav-login" href="/login" onClick={closeMenu}>Log in</Link><Link className="button button-dark button-small" href="/docs#install" onClick={closeMenu}>Explore CLI <Arrow diagonal /></Link></div>
      </div>
    </nav></header>

    <main>
      <section className="hero-section" id="product">
        <div className="hero-aura" aria-hidden="true" /><div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy reveal-up"><div className="eyebrow-pill"><span className="eyebrow-spark">✳</span> DATA ANALYSIS MADE EASY</div>
          <h1>Your CSVs.<br /><span>Your questions.</span><br />SQL in seconds.</h1>
          <p>Ask questions about the data you already have. Queryra turns them into validated SQL and runs it locally—right from your terminal.</p>
          <div className="hero-actions"><Link className="button button-dark" href="/docs#install">Explore the CLI <Arrow /></Link><a className="button button-soft" href="#workflow">View the workflow <Arrow /></a></div>
          <div className="hero-install"><span className="install-prompt">$</span><code>{installCommand}</code><CopyCommand command={installCommand} /></div>
        </div>
        <div className="hero-product hero-video reveal-up reveal-delay"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><ProductVideo /></div>
      </section>

      <section className="tools-marquee" aria-label="Works with your daily tools">
        <h2>Works With Your Daily Needs</h2>
        <div className="tools-marquee-window"><div className="tools-marquee-track">
          {[0, 1].map((copy) => <div className="tools-marquee-group" key={copy} aria-hidden={copy === 1}>
            {[
              ["git.png", "Git"], ["github.png", "GitHub"], ["Google-Antigravity-Icon-Full-Color.png", "Google Antigravity"], ["kiro.png", "Kiro"], ["linux.png", "Linux"], ["npm.png", "npm"], ["powershell.png", "PowerShell"], ["vscode.png", "Visual Studio Code"], ["windows-terminal.png", "Windows Terminal"],
            ].map(([icon, label]) => <div className="tool-marquee-item" key={icon}><img src={`/icons/${icon}`} alt={copy === 0 ? label : ""} /><span>{label}</span></div>)}
          </div>)}
        </div></div>
      </section>

      <QueryraWebComposer />

      <section className="usecase-section" id="use-cases">
        <div className="section-wrap">
          <div className="usecase-title reveal-up"><span className="section-kicker">A FEW PLACES TO START</span><h2>Make your data<br />easier to explore.</h2></div>
          <div className="usecase-grid">
            {useCases.map((item, index) => <Link className="usecase-card" href={`/use-cases/${item.slug}`} key={item.slug}><span className="usecase-card-image"><Image src={item.images[0].src} alt={item.images[0].alt} fill sizes="(max-width: 760px) 45vw, 23vw" priority={index === 0} /></span><h3>{item.cardTitle}</h3></Link>)}
          </div>
        </div>
      </section>

      <section className="product-walkthrough" id="how-it-works" aria-label="See Queryra in action">
        <div className="product-walkthrough-inner">
          <article className="product-walkthrough-row">
            <WalkthroughVideo src="/QueryraTableSelection.mp4" label="Queryra table selection walkthrough" />
            <div className="product-walkthrough-copy">
              <span className="product-walkthrough-step">Start with the right data</span>
              <h2>Pick a table.<br /><span>Get straight to the question.</span></h2>
              <p>Choose the table you want to explore, then ask Queryra about the data it contains.</p>
            </div>
          </article>
          <article className="product-walkthrough-row">
            <WalkthroughVideo src="/queryraResults.mp4" label="Queryra query results walkthrough" />
            <div className="product-walkthrough-copy">
              <span className="product-walkthrough-step">See what your data says</span>
              <h2>Ask in your own words.<br /><span>Get a result you can use.</span></h2>
              <p>Review the answer and its results, then use what you learned to make your next move.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="pathways-section" aria-labelledby="pathways-title">
        <div className="pathways-grid">
          <Link className="pathway-card pathway-web" href="/workspace">
            <div className="pathway-image"><Image src="/webandcliPictures-web.jpg" alt="Queryra Web workspace in a browser" fill sizes="(max-width: 760px) 100vw, 50vw" /></div>
            <div className="pathway-card-copy"><h3>Go full web-based.</h3><p>Upload a file and ask in plain English. Get from data to insight in seconds with Queryra’s fastest, ready-to-go workflow.</p><span className="pathway-action">Open Queryra Web <Arrow /></span></div>
          </Link>
          <Link className="pathway-card pathway-cli" href="/docs#install">
            <div className="pathway-image"><Image src="/webandcliPictures-cmd.jpg" alt="Queryra CLI running in a local terminal" fill sizes="(max-width: 760px) 100vw, 50vw" /></div>
            <div className="pathway-card-copy"><h3>Explore the CLI.</h3><p>Secure, local-first analysis with your files staying on your machine. Bring powerful tools to your terminal with full control.</p><span className="pathway-action">Start setup now <Arrow diagonal /></span></div>
          </Link>
        </div>
      </section>

      <TimeSavingsStory />

      <section className="quickstart-section" id="quickstart"><div className="section-wrap quickstart-wrap"><div className="quickstart-copy reveal-up"><span className="section-kicker">UP AND RUNNING IN A FEW COMMANDS</span><h2>Your terminal.<br /><span>Your data.</span></h2><p>Bring a CSV and your own Gemini API key. No hosted database setup required for the CLI workflow.</p><Link href="/docs" className="text-link">Read the documentation <Arrow /></Link></div><div className="quickstart-panel reveal-up reveal-delay"><div className="quickstart-panel-head"><div className="window-dots"><i /><i /><i /></div><Image className="quickstart-mark" src="/queryra-logo-light.svg" width={18} height={18} alt="" /><span>QUICK START</span><span className="node-badge">NODE.JS 20.9+</span></div><div className="command-list"><div><span>01</span><code><b>$</b> npm install -g queryra-cli</code><small>Install</small></div><div><span>02</span><code><b>$</b> queryra init</code><small>Configure Gemini</small></div><div><span>03</span><code><b>$</b> queryra schema</code><small>Inspect your CSV</small></div><div><span>04</span><code><b>$</b> queryra ask &quot;Show monthly revenue by region&quot;</code><small>Ask away</small></div></div><div className="quickstart-foot"><span><i /> CSV rows stay local</span><Link href="/docs#commands">See all commands <Arrow /></Link></div></div></div></section>

      <section className="faq-section section-wrap" id="faq"><div className="faq-title reveal-up"><span className="section-kicker">GOOD TO KNOW</span><h2>Questions,<br />answered.</h2><p>More detail in the <Link href="/docs">CLI documentation</Link>.</p></div><div className="faq-list">{questions.map(([question, answer]) => <details key={question} className="faq-item"><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>

      <section className="final-cta" onPointerMove={updateFinalGradient}><div className="cta-glow" aria-hidden="true" /><h2>Ask the question.<br />Let SQL do the rest.</h2><p>Start in the browser with Queryra Web or bring Queryra CLI to your terminal.</p><div className="cta-actions"><Link className="button button-dark" href="#queryra-web">Open Queryra Web <Arrow /></Link><Link className="button button-soft" href="/docs#install">Explore CLI <Arrow diagonal /></Link></div></section>
    </main>

    <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><Brand /><p>Natural language to SQL for CSVs on your machine or in a temporary Queryra Web session.</p><span>LOCAL-FIRST CLI · BROWSER-BASED WEB</span></div><div className="footer-links"><div><b>EXPLORE</b><a href="#product">Product</a><a href="#queryra-web">Queryra Web</a><a href="#use-cases">Use cases</a></div><div><b>LEARN</b><Link href="/docs">CLI documentation</Link><Link href="/docs#commands">Command reference</Link><Link href="/resources">Resources</Link></div><div><b>PROJECT</b><a href="https://github.com/LeonDae/Queryra" target="_blank" rel="noreferrer">GitHub <Arrow diagonal /></a><Link href="/login">Log in</Link></div></div></div><div className="footer-bottom"><span>© 2026 Queryra CLI · Open source under MIT</span><span>CLI runs locally · Web uploads are temporary.</span></div><div className="footer-credit">Crafted &amp; Developed by Ditsu</div></footer>
    <ScrollReveal />
  </div>;
}
