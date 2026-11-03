import Image from "next/image";
import Link from "next/link";
import UseCaseNav from "../use-case-nav.jsx";

export const metadata = { title: "Resources — Queryra", description: "Explore data tools and resources that pair with Queryra." };

const resources = [
  { name:"Kaggle", slug:"kaggle", description:"Find datasets to explore, practice your analysis, and learn from a community-built library of data.", note:"A place to discover your next dataset.", href:"https://www.kaggle.com/datasets", icon:"kaggle.png", imageClass:"resource-icon-kaggle" },
  { name:"TradingView", slug:"tradingview", description:"Explore market charts, indicators, and financial data to support your own research and analysis.", note:"Follow the movement behind the numbers.", href:"https://in.tradingview.com/markets/india/", icon:"tradingview-light.png", imageClass:"resource-icon-tradingview" },
  { name:"Google AI Studio", slug:"google-ai-studio", description:"Experiment with Gemini, shape prompts, and prototype AI-powered ideas in the browser.", note:"Turn a first idea into something you can try.", href:"https://aistudio.google.com/prompts/new_chat", icon:"google-gemini.png", imageClass:"resource-icon-google" },
  { name:"Ollama", slug:"ollama", description:"Run open-weight language models on your own machine and explore local model workflows.", note:"Bring model exploration closer to your machine.", href:"https://ollama.com/", icon:"ollama.png", imageClass:"resource-icon-ollama" },
];

export default function ResourcesPage() {
  return <div className="marketing-site resources-page resources-redesign">
    <UseCaseNav />
    <main>
      <section className="resource-new-hero"><span className="section-kicker">TOOLS FOR THE WAY YOU EXPLORE</span><h1>Good data starts<br /><span>with good resources.</span></h1><p>A few useful places to find data, explore markets, and experiment with AI.</p></section>
      <section className="resource-zigzag" id="resource-list" aria-label="Featured resources">
        {resources.map((resource, index) => <article className={`resource-feature resource-feature-${index + 1}`} key={resource.slug} id={resource.slug}>
          <div className={`resource-feature-visual ${resource.imageClass}`}><div className="resource-icon-stage"><Image src={`/resources-icons/${resource.icon}`} alt={`${resource.name} logo`} width={164} height={164} /></div><span className="resource-orbit resource-orbit-one"/><span className="resource-orbit resource-orbit-two"/></div>
          <div className="resource-feature-copy"><h2>{resource.name}</h2><p>{resource.description}</p><div className="resource-note"><span>↳</span>{resource.note}</div><a className="resource-visit-link" href={resource.href} target="_blank" rel="noreferrer">Explore {resource.name}<span aria-hidden="true">↗</span></a></div>
        </article>)}
      </section>
      <section className="resource-new-footer"><span className="section-kicker">YOUR NEXT QUESTION IS WAITING</span><h2>Bring what you find<br />into Queryra.</h2><p>Start with a dataset, then ask a question in your own words.</p><Link className="button button-dark" href="/#use-cases">Explore use cases <span>↗</span></Link></section>
    </main>
    <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><Link className="site-brand" href="/" aria-label="Queryra home"><Image src="/queryra-logo-dark.svg" alt="" width={42} height={42} /><span>queryra<span className="brand-period">.</span></span></Link><p>Natural language to SQL for your data.</p><span>LOCAL-FIRST CLI · BROWSER-BASED WEB</span></div><div className="footer-links"><div><b>EXPLORE</b><Link href="/#product">Product</Link><Link href="/#use-cases">Use cases</Link><Link href="/resources">Resources</Link></div><div><b>LEARN</b><Link href="/docs">CLI documentation</Link><Link href="/docs#commands">Command reference</Link></div><div><b>PROJECT</b><a href="https://github.com/LeonDae/Queryra" target="_blank" rel="noreferrer">GitHub ↗</a><Link href="/login">Log in</Link></div></div></div><div className="footer-bottom"><span>© 2026 Queryra CLI · Open source under MIT</span><span>Choose a resource. Find your next question.</span></div></footer>
  </div>;
}
