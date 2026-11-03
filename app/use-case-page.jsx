import Image from "next/image";
import Link from "next/link";
import Brand from "./brand.jsx";
import UseCaseNav from "./use-case-nav.jsx";
import { useCases } from "./use-case-data.js";

function TerminalPreview({ item }) {
  return <section className="usecase-terminal-section" aria-label={`${item.cardTitle} terminal example`}>
    <div className="usecase-terminal-window">
      <div className="usecase-terminal-top"><div className="window-dots"><i /><i /><i /></div><Brand light /><span className="usecase-terminal-file">{item.terminal.file}</span><span className="usecase-terminal-badge">QUERYRA CLI</span></div>
      <div className="usecase-terminal-body">
        <div className="terminal-question"><span>❯</span><div><small>ASK</small><p>{item.terminal.question}</p></div></div>
        <div className="terminal-code-label"><span>GENERATED SQL</span><span>READ ONLY</span></div>
        <pre><code>{item.terminal.sql}</code></pre>
        <div className="terminal-result-heading"><span>QUERY RESULTS</span><small>{item.terminal.rows.length} rows · preview</small></div>
        <div className="terminal-table-wrap"><table><thead><tr>{item.terminal.columns.map((col) => <th key={col}>{col}</th>)}</tr></thead><tbody>{item.terminal.rows.map((row) => <tr key={row.join("-")}>{row.map((cell, i) => <td key={`${cell}-${i}`}>{cell}</td>)}</tr>)}</tbody></table></div>
      </div>
      <div className="usecase-terminal-foot"><span><i /> Local CSV workflow</span><span>Example preview</span></div>
    </div>
  </section>;
}

export default function UseCasePage({ useCase }) {
  return <div className="marketing-site usecase-detail-page">
    <UseCaseNav />
    <main>
      <section className="usecase-detail-hero"><div className="usecase-detail-hero-inner">
        <Link className="usecase-back-link" href="/#use-cases">← All use cases</Link>
        <div className="usecase-detail-copy"><span className="section-kicker">{useCase.number} · {useCase.category}</span><h1>{useCase.cardTitle}</h1><p>{useCase.summary}</p><Link className="button button-dark" href="/docs#install">Explore the CLI <span aria-hidden="true">↗</span></Link></div>
      </div></section>
      <TerminalPreview item={useCase} />
      <section className="usecase-explainer section-wrap"><div className="usecase-explainer-heading"><span className="section-kicker">THE USE CASE</span><h2>What it means<br />for your team.</h2></div><div className="usecase-explainer-copy"><p className="usecase-definition">{useCase.definition}</p><p>{useCase.description}</p></div></section>
      <section className="usecase-gallery section-wrap" aria-label={`${useCase.cardTitle} photos`}>
        <figure className="usecase-photo usecase-photo-1"><div><Image src={useCase.images[0].src} alt={useCase.images[0].alt} fill sizes="(max-width: 760px) 92vw, 48vw" priority /></div><figcaption><span>01</span>{useCase.images[0].caption}</figcaption></figure>
        <div className="usecase-gallery-statement"><span className="section-kicker">A CLEARER VIEW</span><p>Bring your data into focus.<br /><em>Find the next useful answer.</em></p></div>
        <figure className="usecase-photo usecase-photo-2"><div><Image src={useCase.images[1].src} alt={useCase.images[1].alt} fill sizes="(max-width: 760px) 92vw, 48vw" /></div><figcaption><span>02</span>{useCase.images[1].caption}</figcaption></figure>
      </section>
      <section className="usecase-prompts-section"><div className="section-wrap usecase-prompts-wrap"><div><span className="section-kicker">A FEW WAYS TO ASK</span><h2>Start with a<br />plain question.</h2><p>Try a prompt like these with a CSV that contains the right fields.</p></div><div className="usecase-prompt-list">{useCase.prompts.map((prompt, index) => <div className="usecase-prompt" key={prompt}><span>0{index + 1}</span><p>{prompt}</p><span aria-hidden="true">↗</span></div>)}</div></div></section>
      <section className="usecase-next-section section-wrap"><span className="section-kicker">KEEP EXPLORING</span><h2>Every dataset has<br />another good question.</h2><div className="usecase-next-links">{useCases.filter((item) => item.slug !== useCase.slug).map((item) => <Link href={`/use-cases/${item.slug}`} key={item.slug}><span>{item.number}</span>{item.cardTitle}<b aria-hidden="true">↗</b></Link>)}</div></section>
    </main>
    <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><Brand /><p>Natural language to SQL for CSVs on your machine or in a temporary Queryra Web session.</p><span>LOCAL-FIRST CLI · BROWSER-BASED WEB</span></div><div className="footer-links"><div><b>EXPLORE</b><Link href="/#product">Product</Link><Link href="/#queryra-web">Queryra Web</Link><Link href="/#use-cases">Use cases</Link></div><div><b>LEARN</b><Link href="/docs">CLI documentation</Link><Link href="/resources">Resources</Link></div><div><b>PROJECT</b><a href="https://github.com/LeonDae/Queryra" target="_blank" rel="noreferrer">GitHub ↗</a><Link href="/login">Log in</Link></div></div></div><div className="footer-bottom"><span>© 2026 Queryra CLI · Open source under MIT</span><span>CLI runs locally · Web uploads are temporary.</span></div></footer>
  </div>;
}
