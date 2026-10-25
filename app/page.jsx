"use client";
import { useEffect, useState } from 'react';

/* ============================
   API HELPERS (via Vite Proxy)
   ============================ */

const API_BASE = '/SQG/content/v1';

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await getApiError(res));
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await getApiError(res));
  return res.json();
}

async function apiPostForm(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(await getApiError(res));
  return res.json();
}

async function getApiError(response) {
  try {
    const payload = await response.json();
    return payload.detail || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

/* ============================
   MAIN APP COMPONENT
   ============================ */

export default function App() {
  // -------- UI State --------
  const [question, setQuestion] = useState('');
  const [useLocalLLM, setUseLocalLLM] = useState(false);
  const [serviceOnline, setServiceOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaMode, setSchemaMode] = useState('default');
  const [executeCustomQuery, setExecuteCustomQuery] = useState(false);

  // -------- Data State --------
  const [schema, setSchema] = useState('');
  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [customSchema, setCustomSchema] = useState('');
  const [sql, setSql] = useState('');
  const [generatedContext, setGeneratedContext] = useState(null);
  const [rows, setRows] = useState([]);
  const [executionMeta, setExecutionMeta] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvTableName, setCsvTableName] = useState('');
  const [csvUploading, setCsvUploading] = useState(false);

  // -------- Error State --------
  const [error, setError] = useState('');
  const [feedbackError, setFeedbackError] = useState('');

  // -------- Feedback State --------
  const [feedbackChoice, setFeedbackChoice] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  /* ============================
     HEALTH CHECK + SCHEMA LOAD
     ============================ */
  useEffect(() => {
    apiGet('/health')
      .then(() => setServiceOnline(true))
      .catch(() => setServiceOnline(false));

    apiGet('/schema')
      .then((data) => setSchema(data.schema_text || ''))
      .catch(() => setSchema(''));

    apiGet('/tables')
      .then((data) => setAvailableTables(data.tables || []))
      .catch(() => setAvailableTables([]));
  }, []);

  /* ============================
     SUBMIT HANDLER
     ============================ */
  const handleSubmit = async () => {
    if (!question.trim()) return;

    if (schemaMode === 'selected_tables' && selectedTables.length === 0) {
      setError('Please select at least one table.');
      return;
    }

    if (schemaMode === 'custom' && !customSchema.trim()) {
      setError('Please provide a custom schema.');
      return;
    }

    setLoading(true);
    setError('');
    setFeedbackError('');
    setSql('');
    setGeneratedContext(null);
    setRows([]);
    setExecutionMeta(null);
    setFeedbackChoice(null);
    setFeedbackText('');
    setFeedbackSubmitted(false);

    try {
      const gen = await apiPost('/generate-sql', {
        question,
        pipeline: useLocalLLM ? "slm_review" : "llm",
        schemaMode,
        selectedTables: schemaMode === 'selected_tables' ? selectedTables : [],
        customSchema: schemaMode === 'custom' ? customSchema : '',
      });

      if (!gen.generatedSQL) {
        throw new Error('No SQL query returned from backend');
      }

      setSql(gen.generatedSQL);
      setGeneratedContext({ schemaMode, selectedTables: [...selectedTables] });
      setRows([]);
      setExecutionMeta(null);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Unexpected generation error');
      setSql('');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!sql.trim()) return;
    if (generatedContext?.schemaMode === 'custom' && !executeCustomQuery) {
      setError('Allow execution for the custom schema before running this query.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const exec = await apiPost('/execute-sql', {
        originalQuestion: question,
        generatedSQL: sql,
        selectedTables: generatedContext?.schemaMode === 'selected_tables' ? generatedContext.selectedTables : undefined,
      });
      setRows(exec.rows || []);
      setExecutionMeta({ rowCount: exec.rowCount ?? (exec.rows || []).length, durationMs: exec.durationMs, truncated: exec.truncated });
    } catch (err) {
      setError(err.message || 'Query execution failed.');
      setRows([]);
      setExecutionMeta(null);
    } finally {
      setLoading(false);
    }
  };

  /* ============================
     RESET HANDLER
     ============================ */
  const handleReset = () => {
    setQuestion('');
    setSql('');
    setGeneratedContext(null);
    setRows([]);
    setExecutionMeta(null);
    setError('');
    setFeedbackError('');
    setFeedbackChoice(null);
    setFeedbackText('');
    setFeedbackSubmitted(false);
    setSelectedTables([]);
    setCustomSchema('');
    setCsvFile(null);
    setCsvTableName('');
  };

  /* ============================
     CSV UPLOAD HANDLER
     ============================ */
  const handleCsvUpload = async () => {
    if (!csvFile) {
      setError('Please choose a CSV file to upload.');
      return;
    }

    setCsvUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      if (csvTableName.trim()) {
        formData.append('table_name', csvTableName.trim());
      }

      const res = await apiPostForm('/upload-csv', formData);
      setSchema(res.schema_text || '');
      setAvailableTables(res.tables || []);
      if (res.table_name) {
        setSelectedTables([res.table_name]);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'CSV upload failed.');
    } finally {
      setCsvUploading(false);
    }
  };

  /* ============================
     DOWNLOAD CSV
     ============================ */
  const downloadCSV = () => {
    if (rows.length === 0) {
      alert("No database results available to download");
      return;
    }

    const csvCell = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const headers = Object.keys(rows[0]).map(csvCell).join(",");
    const data = rows.map((row) => Object.values(row).map(csvCell).join(",")).join("\n");

    const blob = new Blob([headers + "\n" + data], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `query_results_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  /* ============================
     COPY TO CLIPBOARD
     ============================ */
  const handleCopyToClipboard = () => {
    if (!sql) return;
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ============================
     FEEDBACK HANDLERS
     ============================ */
  const handleHelpfulSubmit = async () => {
    setFeedbackError('');
    try {
      await apiPost('/feedback', {
        originalQuestion: question,
        generatedSQL: sql,
        satisfied: true,
        feedback: "",
        schemaMode,
        selectedTables: schemaMode === 'selected_tables' ? selectedTables : [],
        customSchema: schemaMode === 'custom' ? customSchema : '',
      });
      setFeedbackSubmitted(true);
    } catch (err) {
      setFeedbackError("Feedback failed to send. Check console for details.");
      console.error(err);
    }
  };

  const handleNotHelpfulSubmit = async () => {
    if (!feedbackText.trim()) {
      setFeedbackError("Please provide details on what went wrong.");
      return;
    }

    setLoading(true);
    setFeedbackError('');

    try {
      const res = await apiPost('/feedback', {
        originalQuestion: question,
        generatedSQL: sql,
        satisfied: false,
        feedback: feedbackText,
        schemaMode,
        selectedTables: schemaMode === 'selected_tables' ? selectedTables : [],
        customSchema: schemaMode === 'custom' ? customSchema : '',
      });

      if (res.regeneratedSQL) {
        setSql(res.regeneratedSQL);
        setRows([]);
        setExecutionMeta(null);
      }

      setFeedbackSubmitted(true);
    } catch (err) {
      setFeedbackError(err.message || "Feedback failed to process.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Pre-process SQL string into lines for the styled editor
  const sqlLines = sql ? sql.split('\n') : ['-- Generated SQL will appear here...'];

  /* ============================
     RENDER
     ============================ */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative overflow-hidden font-sans select-none">
      
      {/* Background Ambient Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-600/10 blur-[150px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-purple-600/10 blur-[150px] pointer-events-none z-0" />

      {/* Modern High-Tech Grid Overlays */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none z-0" />

      <div className="max-w-6xl mx-auto w-full p-4 md:p-8 flex-grow flex flex-col gap-6 relative z-10 select-text">
        
        {/* HEADER BAR */}
        <header className="flex justify-between items-center bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl px-6 py-4 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.3)]">
              <svg className="w-5.5 h-5.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
                SQL<span className="text-slate-100 font-medium">QueryGen</span>
              </h1>
              <p className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold">Intelligent Database Copilot</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border transition-all duration-300 ${
                serviceOnline
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_-3px_rgba(16,185,129,0.25)]'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${serviceOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {serviceOnline ? 'Service Connected' : 'Connection Failed'}
            </span>
          </div>
        </header>

        {/* MAIN INTERFACE SPLIT */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT PANEL: PROMPT, CONTROLS & SETTINGS (COL: 5) */}
          <section className="lg:col-span-5 flex flex-col gap-6">
            
            {/* PROMPT BOX CONTAINER */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 shadow-xl glow-indigo flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                  Natural Language Query
                </label>
                <span className="text-[10px] text-slate-500 font-mono">Ready to process</span>
              </div>

              <textarea
                className="w-full bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/80 transition-all duration-300 resize-none font-sans text-sm leading-relaxed min-h-[120px]"
                placeholder="Ask a question about your database (e.g. 'Show me the top 5 transactions sorted by price margin in 2026')"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={loading}
              />

              {/* SEGMENTED TOGGLE SWITCH */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  Processing Engine
                </span>
                
                <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800/80 relative">
                  <button
                    type="button"
                    onClick={() => !loading && setUseLocalLLM(false)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                      !useLocalLLM 
                        ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/10' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                    </svg>
                    Cloud LLM (Gemini)
                  </button>
                  <button
                    type="button"
                    onClick={() => !loading && setUseLocalLLM(true)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                      useLocalLLM 
                        ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/10' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                    Local SLM + Gemini Review
                  </button>
                </div>
                {useLocalLLM && (
                  <p className="text-[10px] leading-relaxed text-amber-300/90">
                    Hybrid mode sends your question, schema, and local SQL draft to Gemini for review.
                  </p>
                )}
              </div>

              {/* SCHEMA SOURCE CONTROLS */}
              <div className="flex flex-col gap-3">
                <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7" />
                  </svg>
                  Schema Source
                </span>

                <select
                  value={schemaMode}
                  onChange={(e) => {
                    setSchemaMode(e.target.value);
                    setError('');
                  }}
                  disabled={loading}
                  className="w-full bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/80 transition-all duration-300 text-sm"
                >
                  <option value="default">Default database schema</option>
                  <option value="selected_tables">Select database tables</option>
                  <option value="custom">Custom schema</option>
                </select>

                {schemaMode === 'selected_tables' && (
                  <div className="flex flex-col gap-3">
                    <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 max-h-40 overflow-y-auto scrollbar-thin">
                      {availableTables.length === 0 ? (
                        <p className="text-xs text-slate-500">No tables loaded from backend.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {availableTables.map((table) => (
                            <label key={table} className="flex items-center gap-2 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                checked={selectedTables.includes(table)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedTables([...selectedTables, table]);
                                  } else {
                                    setSelectedTables(selectedTables.filter((item) => item !== table));
                                  }
                                }}
                                disabled={loading}
                                className="accent-indigo-500"
                              />
                              <span className="font-mono break-all">{table}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-3">
                      <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Upload CSV to Supabase</p>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                        disabled={loading || csvUploading}
                        className="text-xs text-slate-300"
                      />
                      <input
                        type="text"
                        placeholder="Optional table name (e.g. sales_2026)"
                        value={csvTableName}
                        onChange={(e) => setCsvTableName(e.target.value)}
                        disabled={loading || csvUploading}
                        className="w-full bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/80 transition-all duration-300 text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleCsvUpload}
                        disabled={loading || csvUploading}
                        className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 font-semibold px-3 py-2 rounded-xl transition-all duration-200 text-xs"
                      >
                        {csvUploading ? 'Uploading...' : 'Upload CSV & Create Table'}
                      </button>
                    </div>
                  </div>
                )}

                {schemaMode === 'custom' && (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={customSchema}
                      onChange={(e) => setCustomSchema(e.target.value)}
                      disabled={loading}
                      className="w-full bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/80 transition-all duration-300 resize-none font-mono text-xs leading-relaxed min-h-[130px]"
                      placeholder={`CREATE TABLE customers (
  id INT,
  name TEXT,
  city TEXT
);

CREATE TABLE orders (
  id INT,
  customer_id INT,
  amount NUMERIC,
  order_date DATE
);`}
                    />

                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={executeCustomQuery}
                        onChange={(e) => setExecuteCustomQuery(e.target.checked)}
                        disabled={loading}
                        className="accent-indigo-500"
                      />
                      Allow execution for this custom schema (you will still run SQL explicitly)
                    </label>
                  </div>
                )}
              </div>

              {/* ACTION CONTROL BUTTONS */}
              <div className="flex gap-3 mt-1">
                <button
                  onClick={handleSubmit}
                  disabled={loading || !question.trim()}
                  className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] disabled:opacity-40 disabled:hover:shadow-none flex items-center justify-center gap-2 text-sm"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Analysing Data...
                    </>
                  ) : (
                    <>
                      Generate SQL
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </>
                  )}
                </button>

                {sql && (
                  <button
                    onClick={handleExecute}
                    disabled={loading || (generatedContext?.schemaMode === 'custom' && !executeCustomQuery)}
                    className="border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 disabled:opacity-40 text-sm"
                  >
                    {loading ? 'Running...' : 'Run SQL'}
                  </button>
                )}

                <button
                  onClick={handleReset}
                  className="border border-slate-800 hover:bg-slate-800/40 hover:border-slate-700 text-slate-300 hover:text-slate-100 font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 text-sm"
                  disabled={loading}
                >
                  Reset
                </button>
              </div>

            </div>

            {/* COLLAPSIBLE SCHEMA PANEL */}
            <div className="border border-slate-800 bg-slate-900/30 rounded-2xl overflow-hidden shadow-lg">
              <button
                type="button"
                onClick={() => setSchemaOpen(!schemaOpen)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-900/30 transition-colors duration-150 text-left"
              >
                <span className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Database Schema & Tables
                </span>
                
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${schemaOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {schemaOpen && (
                <div className="bg-slate-950/80 p-4 border-t border-slate-850 overflow-hidden">
                  <pre className="text-[11px] leading-relaxed text-indigo-300/80 font-mono overflow-x-auto max-h-[220px] scrollbar-thin select-text">
                    {schema || '-- Database schema failed to load.'}
                  </pre>
                </div>
              )}
            </div>

          </section>

          {/* RIGHT PANEL: GENERATED SQL & RESULT GRID (COL: 7) */}
          <section className="lg:col-span-7 flex flex-col gap-6">
            
            {/* ERROR NOTIFICATION PANEL */}
            {error && (
              <div className="flex gap-3 bg-rose-500/10 text-rose-400 border border-rose-500/20 p-4 rounded-2xl items-start shadow-[0_0_20px_-3px_rgba(244,63,94,0.15)] animate-fade-in">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="text-sm leading-relaxed">
                  <span className="font-bold">Error encountered: </span>
                  {error}
                </div>
              </div>
            )}

            {/* SQL EDITOR CONTAINER */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl glow-purple flex flex-col">
              
              {/* Fake Code IDE Bar */}
              <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/40 border-b border-slate-850">
                <div className="flex items-center gap-2">
                  <span className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500/50" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/50" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/50" />
                  </span>
                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-widest pl-2 font-mono">generated_query.sql</span>
                </div>

                {sql && (
                  <button
                    onClick={handleCopyToClipboard}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all duration-200 ${
                      copied 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                        : 'bg-slate-900/60 text-slate-400 border-slate-850 hover:text-slate-200 hover:border-slate-800'
                    }`}
                  >
                    {copied ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Monospace Code Editor */}
              <div className="flex bg-slate-950/80 p-5 font-mono text-sm leading-relaxed overflow-x-auto min-h-[140px] select-text">
                {/* Line Numbers Column */}
                <div className="text-right text-slate-650 pr-4 select-none border-r border-slate-900/80 mr-4 flex flex-col">
                  {sqlLines.map((_, i) => (
                    <span key={i} className="text-slate-600 font-mono text-xs leading-relaxed block h-6">{i + 1}</span>
                  ))}
                </div>
                {/* Code Block */}
                <div className="flex-1">
                  {sqlLines.map((line, i) => (
                    <span 
                      key={i} 
                      className={`block h-6 leading-relaxed text-xs ${
                        line.trim().startsWith('--') 
                          ? 'text-slate-500 font-normal italic' 
                          : 'text-indigo-300 font-medium'
                      }`}
                    >
                      {line || ' '}
                    </span>
                  ))}
                </div>
              </div>

            </div>

            {/* DYNAMIC QUERY RESULTS PANEL */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 shadow-xl glow-cyan flex flex-col gap-4">
              
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Query Results
                </h3>

                {rows.length > 0 && (
                  <button
                    onClick={downloadCSV}
                    className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-bold px-3 py-1.5 rounded-xl transition-all duration-300 flex items-center gap-1.5 text-xs shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download CSV
                  </button>
                )}
              </div>

              {executionMeta && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
                  <span>{executionMeta.rowCount.toLocaleString()} rows</span>
                  {Number.isFinite(executionMeta.durationMs) && <span>{executionMeta.durationMs} ms</span>}
                  {executionMeta.truncated && <span className="text-amber-300">Results capped by server limit</span>}
                </div>
              )}

              {rows.length === 0 ? (
                <div className="border border-dashed border-slate-800/80 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-slate-950 flex items-center justify-center border border-slate-800">
                    <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0H4m16 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2v-1m16 0H4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm font-semibold">No results loaded yet</p>
                    <p className="text-slate-500 text-xs mt-1">Submit a SQL query to visualize active records.</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-850 bg-slate-950/40 max-h-[300px] scrollbar-thin">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-slate-850 bg-slate-950/80">
                        {Object.keys(rows[0]).map((key) => (
                          <th key={key} className="border-r border-slate-850 last:border-r-0 px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-950/20 font-mono">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-slate-900/60 hover:bg-slate-900/30 transition-colors duration-100 last:border-b-0">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="border-r border-slate-900/40 last:border-r-0 px-4 py-2.5 text-xs text-slate-300 font-mono whitespace-nowrap">
                              {val === null || val === undefined ? (
                                <span className="text-slate-650 font-normal italic">NULL</span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* FEEDBACK ASSESSMENT PANEL */}
            {sql && (
              <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
                
                <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Quality Assessment
                </h3>

                {!feedbackChoice && (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-950/60 border border-slate-850 p-4 rounded-xl">
                    <span className="text-xs font-semibold text-slate-300">Are you satisfied with the generated SQL query?</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setFeedbackChoice('yes')}
                        className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-bold px-4 py-2 rounded-xl transition-all duration-200 flex items-center gap-2 text-xs"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 10h4.757a2.25 2.25 0 012.235 2.502l-1.39 8.34A2.25 2.25 0 0117.37 23H7.5V10M14 10V6.75A2.75 2.75 0 0011.25 4h-.5a.75.75 0 00-.75.75V10h4zM7.5 10H4a1 1 0 00-1 1v11a1 1 0 001 1h3.5V10z" />
                        </svg>
                        Yes, Correct
                      </button>

                      <button
                        onClick={() => setFeedbackChoice('no')}
                        className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold px-4 py-2 rounded-xl transition-all duration-200 flex items-center gap-2 text-xs"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14H5.243a2.25 2.25 0 01-2.235-2.502l1.39-8.34A2.25 2.25 0 016.63 1H16.5v13M10 14v3.25A2.75 2.75 0 0012.75 20h.5a.75.75 0 00.75-.75V14h-4zM16.5 14H20a1 1 0 001-1V2a1 1 0 00-1-1h-3.5v13z" />
                        </svg>
                        No, Incorrect
                      </button>
                    </div>
                  </div>
                )}

                {feedbackChoice === 'yes' && !feedbackSubmitted && (
                  <div className="flex items-center justify-between gap-3 bg-emerald-500/5 border border-emerald-500/20 p-4 rounded-xl animate-fade-in">
                    <div>
                      <p className="text-emerald-400 font-bold text-xs">Excellent! Let's submit this rating.</p>
                      <p className="text-slate-500 text-[10px] mt-0.5">Helps improve future queries.</p>
                    </div>
                    <button
                      onClick={handleHelpfulSubmit}
                      className="bg-indigo-500 hover:bg-indigo-400 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all duration-200 shadow-md shadow-indigo-500/10"
                    >
                      Confirm Submit
                    </button>
                  </div>
                )}

                {feedbackChoice === 'no' && !feedbackSubmitted && (
                  <div className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex flex-col gap-3 animate-fade-in">
                    <div>
                      <p className="text-rose-400 font-bold text-xs">Let's refine the query</p>
                      <p className="text-slate-500 text-[10px] mt-0.5">State what was wrong to regenerate with instructions.</p>
                    </div>
                    
                    <textarea
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 placeholder-slate-650 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/80 transition-all duration-300 resize-none font-sans text-xs min-h-[70px]"
                      placeholder="Explain the error (e.g. 'Table transactions has no cost column' or 'Use delivered_days <= 5 instead')"
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      disabled={loading}
                    />

                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={handleNotHelpfulSubmit}
                        disabled={loading || !feedbackText.trim()}
                        className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all duration-200"
                      >
                        {loading ? 'Regenerating...' : 'Regenerate Query'}
                      </button>

                      <button
                        onClick={() => {
                          setFeedbackChoice(null);
                          setFeedbackText('');
                          setFeedbackError('');
                        }}
                        disabled={loading}
                        className="border border-slate-800 hover:bg-slate-800/40 text-slate-400 hover:text-slate-200 px-4 py-2 rounded-xl text-xs transition-all duration-200"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {feedbackError && (
                  <p className="text-rose-400 text-xs font-semibold bg-rose-500/10 p-3 rounded-lg border border-rose-500/15">{feedbackError}</p>
                )}

                {feedbackSubmitted && (
                  <p className="text-cyan-400 text-xs font-semibold bg-cyan-500/10 p-3 rounded-lg border border-cyan-500/15 flex items-center gap-2 animate-fade-in">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Assessment complete! Your feedback was registered and processed successfully.
                  </p>
                )}
              </div>
            )}

          </section>

          </main>
        
        </div>

      {/* Footer Info */}
      <footer className="w-full border-t border-slate-900 py-4 text-center text-[10px] text-slate-500 font-medium relative z-10 select-none">
        SQLQueryGen Platform • COE GenAI Hub • Powered by Gemini Flash
      </footer>

    </div>
  );
}
