"use client";

import { useState } from "react";
import Link from "next/link";
import Brand from "./brand.jsx";
import { useCases } from "./use-case-data.js";

const resources = [
  ["Get Your Own Data Set", "kaggle", "kaggle.png"],
  ["Start Your Stock Analysis", "tradingview", "tradingview-light.png"],
  ["Get Your API Key", "google-ai-studio", "google-gemini.png"],
  ["Setup Local Language Model", "ollama", "ollama.png"],
];

export default function UseCaseNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  return <header className="site-header"><nav className="site-nav" aria-label="Main navigation">
    <Brand />
    <button className="mobile-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="usecase-site-menu" onClick={() => setMenuOpen(!menuOpen)}><span /><span /><span /><span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span></button>
    <div className={`site-menu${menuOpen ? " is-open" : ""}`} id="usecase-site-menu">
      <div className="site-links"><Link href="/#workflow" onClick={closeMenu}>How it works</Link><details className="nav-dropdown"><summary>Use cases <span aria-hidden="true" /></summary><div className="nav-dropdown-menu">{useCases.map((item) => <Link key={item.slug} href={`/use-cases/${item.slug}`} onClick={closeMenu}>{item.cardTitle}</Link>)}</div></details><Link href="/docs" onClick={closeMenu}>CLI</Link><Link href="/#queryra-web" onClick={closeMenu}>Queryra Web</Link><details className="nav-dropdown resource-nav-dropdown"><summary>Resources <span aria-hidden="true" /></summary><div className="nav-dropdown-menu">{resources.map(([name, slug, icon]) => <Link className="resource-nav-link" key={slug} href={`/resources#${slug}`} onClick={closeMenu}><img src={`/resources-icons/${icon}`} alt="" />{name}<span aria-hidden="true">↗</span></Link>)}</div></details></div>
      <div className="nav-actions"><Link className="nav-login" href="/login" onClick={closeMenu}>Log in</Link><Link className="button button-dark button-small" href="/docs#install" onClick={closeMenu}>Explore CLI <span aria-hidden="true">↗</span></Link></div>
    </div>
  </nav></header>;
}
