"use client";

import { useRef, useState } from "react";
import { updatePointerGradient } from "./pointer-gradient.js";

const API = "/SQG/content/v1";
const examples = [
  "Show monthly revenue by region",
  "Which products have the lowest inventory?",
  "Find the top five customers by total sales",
  "Count transactions by category",
];

async function readResponse(response) {
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.detail || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

function uploadWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API}${path}`);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      let response;
      try { response = JSON.parse(request.responseText); } catch { response = {}; }
      if (request.status < 200 || request.status >= 300) {
        const error = new Error(response.detail || `Request failed (${request.status}).`);
        error.status = request.status;
        error.code = response.code;
        reject(error);
      } else resolve(response);
    });
    request.addEventListener("error", () => reject(new Error("Network error while uploading. Check your connection and try again.")));
    request.addEventListener("abort", () => reject(new Error("Upload was canceled.")));
    request.send(formData);
  });
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function QueryraWebComposer() {
  const fileInput = useRef(null);
  const panel = useRef(null);
  const [file, setFile] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [worksheet, setWorksheet] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [datasetInfo, setDatasetInfo] = useState(null);
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState([]);
  const [queryMeta, setQueryMeta] = useState(null);

  function updatePointer(event) {
    updatePointerGradient(panel.current, event, "--composer-x", "--composer-y");
  }

  async function selectFile(nextFile) {
    setError(""); setDatasetInfo(null); setFile(null); setWorksheets([]); setWorksheet("");
    setSql(""); setRows([]); setQueryMeta(null);
    if (!nextFile) {
      if (fileInput.current) fileInput.current.value = "";
      void fetch(`${API}/guest-clear`, { method: "POST" }).catch(() => {});
      return;
    }
    const name = nextFile.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) {
      setError("Choose a .csv file or an .xlsx workbook. Legacy .xls files are not supported.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setError("Files must be no larger than 10 MB.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(nextFile);
    if (name.endsWith(".xlsx")) {
      setStatus("Reading worksheet names…");
      try {
      const form = new FormData(); form.append("file", nextFile);
        const data = await readResponse(await fetch(`${API}/guest-workbook-sheets`, { method: "POST", body: form }));
        setWorksheets(data.worksheets || []);
        setWorksheet(data.worksheets?.[0] || "");
        if (!data.worksheets?.length) setError("This workbook has no worksheets to import.");
      } catch (cause) {
        setError(cause.message);
      } finally { setStatus(""); }
    }
  }

  async function handleAsk(event) {
    event.preventDefault();
    setError(""); setSql(""); setRows([]); setQueryMeta(null); setDatasetInfo(null);
    if (!file && !question.trim()) { setError("Upload a CSV or Excel file and enter a question to continue."); return; }
    if (file && !question.trim()) { setError("Enter a question about your data."); return; }
    if (!file && question.trim()) { setError("Upload a CSV or Excel file first."); return; }
    if (file?.name.toLowerCase().endsWith(".xlsx") && !worksheet) { setError("Choose a worksheet from the workbook first."); return; }
    setBusy(true); setStatus("Uploading your file and preparing the query…"); setUploadProgress(0);
    try {
      const form = new FormData();
      form.append("question", question.trim());
      form.append("file", file);
      if (file.name.toLowerCase().endsWith(".xlsx")) form.append("worksheet_name", worksheet);
      const result = await uploadWithProgress("/guest-ask", form, setUploadProgress);
      setSql(result.generatedSQL || "");
      setRows(result.rows || []);
      setQueryMeta({ rowCount: result.rowCount ?? result.rows?.length ?? 0, durationMs: result.durationMs, truncated: result.truncated });
      setDatasetInfo(result.dataset || null);
      setStatus("SQL safety checks passed · results ready");
    } catch (cause) {
      setError(cause.message || "The request could not be completed.");
      setStatus("");
    } finally { setBusy(false); }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  }

  return <section className="web-composer-section" id="queryra-web" aria-labelledby="web-composer-title">
    <div className="web-composer-aura" aria-hidden="true" />
    <div className="web-composer-wrap">
      <header className="web-composer-heading"><h2 id="web-composer-title">Let’s see Queryra<br /><span>in action.</span></h2><p>Upload a CSV or Excel workbook, choose a worksheet, and get a schema-grounded SQL answer for your data.</p></header>
      <div ref={panel} className="web-composer-panel" onPointerMove={updatePointer} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("is-dragging"); }} onDragLeave={(event) => event.currentTarget.classList.remove("is-dragging")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("is-dragging"); selectFile(event.dataTransfer.files?.[0]); }}>
        <form onSubmit={handleAsk}>
          {!file && <div className="composer-empty-state"><b>Start with your own data</b><span>Upload a CSV or Excel workbook to begin exploring it with natural language.</span></div>}
          <div className="composer-upload-row">
            <input ref={fileInput} className="sr-only" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => selectFile(event.target.files?.[0])} aria-label="Choose a CSV or Excel workbook" />
            <button type="button" className="composer-file-button" onClick={() => fileInput.current?.click()} disabled={busy}>＋ <span>{file ? "Replace file" : "Add CSV or XLSX"}</span></button>
          </div>
          {file && <div className="composer-file-preview"><span className="file-type-icon">{file.name.toLowerCase().endsWith(".xlsx") ? "XLSX" : "CSV"}</span><span className="file-preview-name"><b>{file.name}</b><small>{formatSize(file.size)} · Ready for this session</small></span><button type="button" onClick={() => selectFile(null)} disabled={busy} aria-label="Remove selected file">×</button></div>}
          {worksheets.length > 0 && <label className="composer-sheet-select">Workbook worksheet<select value={worksheet} onChange={(event) => setWorksheet(event.target.value)} disabled={busy}>{worksheets.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
          <textarea id="web-question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask a question about your data…" rows={3} maxLength={8000} disabled={busy} />
          <p className="composer-retention-note">Kept for 30 mins then removed.</p>
          <div className="composer-submit-row"><span aria-hidden="true" /> <button className="composer-ask-button" disabled={busy} type="submit">{busy ? "Working…" : file ? "Upload & ask" : "Ask Queryra"}<span aria-hidden="true">{busy ? <i className="composer-spinner" /> : "↗"}</span></button></div>
          {busy && file && <div className="upload-progress" role="status"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress ? `Uploading ${uploadProgress}%` : status}</small></div>}
          <div className="composer-examples"><span>TRY ASKING</span>{examples.map((example) => <button type="button" key={example} onClick={() => setQuestion(example)} disabled={busy}>{example}</button>)}</div>
        </form>
        {status && <p className="composer-status" role="status"><i className={busy ? "composer-spinner" : "status-check"}>{busy ? "" : "✓"}</i>{status}</p>}
        {error && <div className="composer-error" role="alert"><b>Couldn’t complete that request.</b><p>{error}</p></div>}
        {datasetInfo && <div className="composer-dataset-result" role="status"><div><span className="status-check">✓</span><span><b>File processed for this session</b><small>{datasetInfo.fileName} · {datasetInfo.rowCount} rows · {datasetInfo.columns?.length || 0} columns{datasetInfo.worksheet ? ` · sheet “${datasetInfo.worksheet}”` : ""} · clears after 30 minutes</small></span></div></div>}
        {sql && <section className="composer-query-result" aria-label="Query response"><header><span>GENERATED SQL</span><b className={queryMeta ? "query-valid" : "query-pending"}>{queryMeta ? "✓ VALIDATED & EXECUTED" : "AWAITING VALIDATION"}</b></header><pre><code>{sql}</code></pre>{queryMeta && <><div className="composer-result-heading"><b>QUERY RESULTS</b><span>{queryMeta.rowCount} rows{Number.isFinite(queryMeta.durationMs) ? ` · ${queryMeta.durationMs} ms` : ""}{queryMeta.truncated ? " · capped" : ""}</span></div>{rows.length ? <div className="composer-results-scroll"><table><thead><tr>{Object.keys(rows[0]).map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{Object.values(row).map((value, cell) => <td key={cell}>{value == null ? "NULL" : String(value)}</td>)}</tr>)}</tbody></table></div> : <p className="composer-empty-results">The query completed successfully and returned no rows.</p>}</>}</section>}
      </div>
      <div className="trust-strip" aria-label="How Queryra works">
        <div className="trust-strip-step"><span>Choose a file</span></div>
        <span className="strip-arrow" aria-hidden="true">→</span>
        <div className="trust-strip-step"><span>Ask your question</span></div>
        <span className="strip-arrow" aria-hidden="true">→</span>
        <div className="trust-strip-step"><span>Explore the answer</span></div>
      </div>
    </div>
  </section>;
}
