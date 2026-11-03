"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import SignOutButton from "./sign-out-button.jsx";

/* ============================
   API HELPERS
   ============================ */

const API_BASE = '/SQG/content/v1';

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await getApiError(res));
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await getApiError(res));
  return res.json();
}

async function apiPostForm(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
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

const EXAMPLE_QUERIES = [
  "Show top 5 transactions sorted by total amount",
  "What is the average transaction value by region?",
  "Count active records grouped by status",
  "List the latest 10 entries created this month",
];

export default function QueryraApp({ initialUser }) {
  // -------- UI State --------
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // -------- Data State --------
  const [schema, setSchema] = useState("");
  const [availableTables, setAvailableTables] = useState([]);
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState([]);
  const [executionMeta, setExecutionMeta] = useState(null);

  // -------- File Upload State --------
  const [csvFile, setCsvFile] = useState(null);
  const [csvTableName, setCsvTableName] = useState("");
  const [worksheets, setWorksheets] = useState([]);
  const [selectedWorksheet, setSelectedWorksheet] = useState("");
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvUploadResult, setCsvUploadResult] = useState(null);
  const csvFileInputRef = useRef(null);

  // -------- Error & Feedback State --------
  const [error, setError] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackChoice, setFeedbackChoice] = useState(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const [userName, setUserName] = useState(
    initialUser?.firstName ||
    initialUser?.user_metadata?.first_name ||
    initialUser?.email?.split("@")[0] ||
    "Developer"
  );

  async function loadWorkspaceTables() {
    try {
      const data = await apiGet("/tables");
      setAvailableTables(data.tables || []);
      const schemaData = await apiGet("/schema");
      setSchema(schemaData.schema_text || "");
    } catch {
      setAvailableTables([]);
      setSchema("");
    }
  }

  /* ============================
     INITIAL LOAD
     ============================ */
  useEffect(() => {
    // The async loader updates state only after its API requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkspaceTables();
    try {
      import("../lib/supabase/client.js").then(({ createClient }) => {
        createClient().auth.getUser().then(({ data }) => {
          if (data?.user) {
            const name = data.user.user_metadata?.first_name 
              || data.user.user_metadata?.full_name?.split(" ")[0] 
              || data.user.email?.split("@")[0];
            if (name) setUserName(name);
          }
        }).catch(() => {});
      });
    } catch {}
  }, []);

  // -------- Table Deletion State --------
  const [tableToDelete, setTableToDelete] = useState(null);
  const [deletingTable, setDeletingTable] = useState(false);
  const [tableActionMessage, setTableActionMessage] = useState("");

  async function handleDeleteTable(tableName) {
    if (!tableName) return;
    setDeletingTable(true);
    setError("");
    try {
      const res = await apiPost("/delete-table", { tableName });
      setAvailableTables(res.tables || []);
      setSchema(res.schema_text || "");
      const cleanName = tableName.replace(/^qr_[a-f0-9]+_/, "");
      setTableActionMessage(`Table "${cleanName}" removed from workspace.`);
      setTimeout(() => setTableActionMessage(""), 4000);
      setTableToDelete(null);
      if (!res.tables || res.tables.length === 0) {
        setRows([]);
        setSql("");
        setExecutionMeta(null);
      }
    } catch (err) {
      setError(err.message || "Failed to remove table.");
    } finally {
      setDeletingTable(false);
    }
  }

  /* ============================
     FILE HANDLING
     ============================ */
  async function handleFileSelected(file) {
    if (!file) return;
    setError("");
    setCsvUploadResult(null);

    const name = file.name.toLowerCase();
    const isCsv = name.endsWith(".csv");
    const isXlsx = name.endsWith(".xlsx");

    if (!isCsv && !isXlsx) {
      setError("Please select a .csv file or .xlsx Excel workbook.");
      if (csvFileInputRef.current) csvFileInputRef.current.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Files must be 10 MB or smaller.");
      if (csvFileInputRef.current) csvFileInputRef.current.value = "";
      return;
    }

    setCsvFile(file);

    // If Excel, inspect worksheets
    if (isXlsx) {
      try {
        const form = new FormData();
        form.append("file", file);
        const sheetData = await apiPostForm("/workbook-sheets", form);
        const sheets = sheetData.worksheets || [];
        setWorksheets(sheets);
        setSelectedWorksheet(sheets[0] || "");
      } catch (err) {
        setError(err.message || "Could not read workbook sheets.");
      }
    } else {
      setWorksheets([]);
      setSelectedWorksheet("");
    }
  }

  async function handleUploadAndIndex() {
    if (!csvFile) {
      setError("Please choose a CSV or Excel file first.");
      csvFileInputRef.current?.click();
      return;
    }

    setCsvUploading(true);
    setError("");
    setCsvUploadResult(null);

    try {
      const isXlsx = csvFile.name?.toLowerCase().endsWith(".xlsx");
      const formData = new FormData();
      formData.append('file', csvFile);

      if (csvTableName.trim()) {
        formData.append('table_name', csvTableName.trim());
      }

      let res;
      if (isXlsx) {
        if (!selectedWorksheet) {
          throw new Error("Please select a worksheet from the workbook.");
        }
        formData.append("worksheet_name", selectedWorksheet);
        res = await apiPostForm("/upload-workbook", formData);
      } else {
        res = await apiPostForm("/upload-csv", formData);
      }

      setSchema(res.schema_text || "");
      setAvailableTables(res.tables || []);
      setCsvUploadResult(res);
      setCsvFile(null);
      setCsvTableName("");
      setWorksheets([]);
      setSelectedWorksheet("");
      if (csvFileInputRef.current) csvFileInputRef.current.value = "";
    } catch (err) {
      setError(err.message || "Dataset ingestion failed.");
    } finally {
      setCsvUploading(false);
    }
  }

  /* ============================
     SQL GENERATION & EXECUTION
     ============================ */
  async function handleGenerateSql() {
    if (!question.trim()) return;

    setLoading(true);
    setError("");
    setFeedbackError("");
    setSql("");
    setRows([]);
    setExecutionMeta(null);
    setFeedbackChoice(null);
    setFeedbackText("");
    setFeedbackSubmitted(false);

    try {
      const gen = await apiPost("/generate-sql", {
        question: question.trim(),
        pipeline: "llm",
        schemaMode: "default",
      });

      if (!gen.generatedSQL) {
        throw new Error("No SQL statement returned from generator.");
      }

      setSql(gen.generatedSQL);
    } catch (err) {
      setError(err.message || "Failed to generate SQL from your query.");
      setSql("");
    } finally {
      setLoading(false);
    }
  }

  async function handleExecuteSql() {
    if (!sql.trim()) return;

    setExecuting(true);
    setError("");

    try {
      const exec = await apiPost("/execute-sql", {
        originalQuestion: question,
        generatedSQL: sql,
      });

      setRows(exec.rows || []);
      setExecutionMeta({
        rowCount: exec.rowCount ?? (exec.rows || []).length,
        durationMs: exec.durationMs,
        truncated: exec.truncated,
      });
    } catch (err) {
      setError(err.message || "Query execution failed.");
      setRows([]);
      setExecutionMeta(null);
    } finally {
      setExecuting(false);
    }
  }

  function handleReset() {
    setQuestion("");
    setSql("");
    setRows([]);
    setExecutionMeta(null);
    setError("");
    setFeedbackError("");
    setFeedbackChoice(null);
    setFeedbackText("");
    setFeedbackSubmitted(false);
  }

  function handleCopySql() {
    if (!sql) return;
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadCSV() {
    if (rows.length === 0) return;
    const csvCell = (value) => {
      const text = value === null || value === undefined ? "" : String(value);
      const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const headers = Object.keys(rows[0]).map(csvCell).join(",");
    const data = rows.map((row) => Object.values(row).map(csvCell).join(",")).join("\n");
    const blob = new Blob([headers + "\n" + data], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `queryra_results_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /* ============================
     FEEDBACK
     ============================ */
  async function handleFeedbackHelpful() {
    setFeedbackError("");
    try {
      await apiPost("/feedback", {
        originalQuestion: question,
        generatedSQL: sql,
        satisfied: true,
        feedback: "",
        schemaMode: "default",
      });
      setFeedbackSubmitted(true);
    } catch {
      setFeedbackError("Could not submit feedback.");
    }
  }

  async function handleFeedbackRefine() {
    if (!feedbackText.trim()) {
      setFeedbackError("Please describe what needs to be changed in the query.");
      return;
    }
    setLoading(true);
    setFeedbackError("");

    try {
      const res = await apiPost("/feedback", {
        originalQuestion: question,
        generatedSQL: sql,
        satisfied: false,
        feedback: feedbackText,
        schemaMode: "default",
      });

      if (res.regeneratedSQL) {
        setSql(res.regeneratedSQL);
        setRows([]);
        setExecutionMeta(null);
      }
      setFeedbackSubmitted(true);
    } catch (err) {
      setFeedbackError(err.message || "Feedback refinement failed.");
    } finally {
      setLoading(false);
    }
  }

  const sqlLines = sql ? sql.split("\n") : ["-- Generated SQL will appear here..."];
  const hasDatasets = availableTables.length > 0;

  return (
    <div className="workspace-shell min-h-screen bg-[#f8f9fc] text-[#1c1d22] font-sans antialiased selection:bg-indigo-500/15">
      {/* Subtle architectural background */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(#e4e7ef_1px,transparent_1px)] [background-size:24px_24px] opacity-60 z-0" />

      {/* Top Header Navigation */}
      <header className="sticky top-0 z-40 w-full bg-white/80 backdrop-blur-xl border-b border-slate-200/80 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between">
          
          {/* Brand & Workspace Tabs */}
          <div className="flex items-center gap-8">
            <Link href="/workspace" className="site-brand flex items-center gap-2.5 group transition-transform duration-200 active:scale-[0.98]" aria-label="Queryra workspace">
              <Image src="/queryra-logo-dark.svg" width={42} height={42} alt="Queryra" priority className="w-[42px] h-[42px] object-contain transition-transform duration-200 group-hover:scale-105" />
              <span className="brand-heading text-[22px] font-[750] tracking-[-0.075em] text-[#15151a]">
                Queryra<span>.</span>
              </span>
            </Link>

            {/* Navigation Tabs */}
            <nav className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl border border-slate-200/60 shadow-inner">
              <span className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold bg-white text-indigo-600 shadow-sm border border-slate-200/60 flex items-center gap-2 transition-all duration-200 cursor-default">
                <svg className="w-4 h-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Query Workspace
              </span>
              <Link
                href="/schema-studio"
                className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/60 active:scale-95 transition-all duration-200 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-slate-500 group-hover:text-slate-900 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                Schema Studio
              </Link>
              <Link
                href="/docs"
                className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/60 active:scale-95 transition-all duration-200 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-slate-500 group-hover:text-slate-900 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                Docs
              </Link>
            </nav>
          </div>

          {/* Right User Bar */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200/70 text-indigo-700 flex items-center justify-center font-bold text-xs shadow-inner">
              {userName.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs font-semibold text-slate-700 hidden sm:inline">
              {userName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 max-w-[1440px] mx-auto px-6 py-8">
        
        {/* Workspace Top Context Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/80">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold tracking-wider uppercase mb-2">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              DATA WORKSPACE
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Query Workspace
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Upload a dataset, ask a question, and review the SQL and results together.
            </p>
          </div>

          {/* Dataset Status Banner */}
          <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200/80 shadow-sm self-start md:self-auto">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm ${
              hasDatasets ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"
            }`}>
              {availableTables.length}
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                {hasDatasets ? "Active Datasets" : "No Datasets Loaded"}
              </div>
              <div className="text-[11px] text-slate-500">
                {hasDatasets
                  ? "Schema indexed & ready to query"
                  : "Upload a file or deploy in Schema Studio"}
              </div>
            </div>
          </div>
        </div>

        {/* Studio Grid: 4 Cols Control Sidebar, 8 Cols Main Workbench */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* ==============================================================
             LEFT SIDEBAR: INGESTION, PROCESSING MODE & SCHEMA (4 Cols)
             ============================================================== */}
          <aside className="lg:col-span-4 flex flex-col gap-6">

            {/* Ingestion Dropzone Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Upload Dataset
                  </h2>
                </div>
                <span className="text-[10px] font-mono font-medium text-slate-400">CSV · XLSX</span>
              </div>

              {/* Drag and Drop Surface */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileSelected(file);
                }}
                onClick={() => csvFileInputRef.current?.click()}
                className={`p-6 rounded-xl border-2 border-dashed text-center cursor-pointer transition-all ${
                  isDraggingFile
                    ? "border-indigo-500 bg-indigo-50/50 scale-[1.01]"
                    : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50/70"
                }`}
              >
                <input
                  ref={csvFileInputRef}
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => {
                    const selectedFile = e.target.files?.[0] || null;
                    setCsvFile(selectedFile);
                    if (selectedFile) {
                      setError("");
                      setCsvUploadResult(null);
                    }
                  }}
                  className="hidden"
                />

                <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-500 mb-2">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                    <path d="M12 12v9" />
                    <path d="m16 16-4-4-4 4" />
                  </svg>
                </div>
                <div className="text-xs font-bold text-slate-800">
                  {csvFile ? csvFile.name : "Choose a file or drag here"}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  CSV or Excel (.xlsx) up to 10 MB
                </div>
              </div>

              {/* File details & options if file selected */}
              {csvFile && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 truncate max-w-[200px]">
                      {csvFile.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setCsvFile(null); setWorksheets([]); if (csvFileInputRef.current) csvFileInputRef.current.value = ""; }}
                      className="text-slate-400 hover:text-rose-500 text-xs font-bold px-1"
                    >
                      Remove
                    </button>
                  </div>

                  {/* If Excel workbook, show worksheet selector */}
                  {worksheets.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-600">Select Worksheet</label>
                      <select
                        value={selectedWorksheet}
                        onChange={(e) => setSelectedWorksheet(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-800 font-medium"
                      >
                        {worksheets.map((sheet) => (
                          <option key={sheet} value={sheet}>{sheet}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Custom Table Name */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-600">
                      Table Name <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. sales_q4"
                      value={csvTableName}
                      onChange={(e) => setCsvTableName(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-800 placeholder-slate-400"
                    />
                  </div>

                  {/* Upload Action */}
                  <button
                    type="button"
                    onClick={handleUploadAndIndex}
                    disabled={loading || csvUploading}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    {csvUploading ? 'Uploading...' : 'Upload CSV & Create Table'}
                  </button>
                </div>
              )}

              {/* Upload Success Notice */}
              {csvUploadResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold mt-0.5 flex-shrink-0">
                    ✓
                  </div>
                  <div>
                    <strong className="block font-bold">
                      {csvUploadResult.dataset?.name || csvUploadResult.dataset_name || "Dataset"} Ready
                    </strong>
                    <span className="text-[11px] text-emerald-700">
                      {csvUploadResult.inserted_rows ?? csvUploadResult.dataset?.row_count ?? 0} rows indexed across {csvUploadResult.columns?.length ?? 0} columns.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Processing Engine Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" />
                    <line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" />
                    <line x1="15" y1="20" x2="15" y2="23" />
                  </svg>
                </div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Processing Engine
                </h2>
              </div>

              {/* Engine Option 1: Cloud AI (Default) */}
              <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/40 relative">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                    Cloud AI Engine
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-100 text-indigo-700">
                    Default
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  High-speed schema-aware query generation. Optimized for complex joins, multi-table aggregations, and analytical queries.
                </p>
              </div>

              {/* Engine Option 2: Private SLM (Enterprise Contact) */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 font-bold text-xs text-slate-800">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                    Private SLM Deployment
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                    Enterprise
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                  Self-hosted small language model running in your private VPC or on-premise hardware with zero data egress.
                </p>
                <button
                  type="button"
                  onClick={() => setContactModalOpen(true)}
                  className="w-full py-1.5 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  Contact Engineering
                </button>
              </div>
            </div>

            {/* Active Workspace Tables & Schema Inspector */}
            {hasDatasets && (
              <div className="qr-workspace-table-panel bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <svg className="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                    Workspace Tables ({availableTables.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSchemaOpen(!schemaOpen)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1 active:scale-95"
                  >
                    {schemaOpen ? (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="18 15 12 9 6 15" />
                        </svg>
                        Hide Blueprint
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        Inspect Blueprint
                      </>
                    )}
                  </button>
                </div>

                {/* Table Removal Notification Banner */}
                {tableActionMessage && (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium flex items-center justify-between qr-animate-fade">
                    <span>✓ {tableActionMessage}</span>
                    <button
                      type="button"
                      onClick={() => setTableActionMessage("")}
                      className="text-emerald-600 hover:text-emerald-900 ml-2"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Table Rows with Delete Option */}
                <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-0.5">
                  {availableTables.map((tbl) => {
                    const cleanName = tbl.replace(/^qr_[a-f0-9]+_/, "");
                    const isDeletingThis = tableToDelete === tbl;

                    if (isDeletingThis) {
                      return (
                        <div
                          key={tbl}
                          className="p-3 rounded-xl bg-rose-50 border border-rose-200/80 text-xs flex flex-col gap-2 qr-animate-fade"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-rose-900">
                              Remove table &quot;{cleanName}&quot;?
                            </span>
                            <span className="text-[11px] text-rose-600 font-medium">Irreversible</span>
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setTableToDelete(null)}
                              disabled={deletingTable}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/60 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTable(tbl)}
                              disabled={deletingTable}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
                            >
                              {deletingTable ? "Removing…" : "Confirm Remove"}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={tbl}
                        className="qr-workspace-table-row px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/70 border border-slate-200/80 text-xs font-mono text-slate-700 flex items-center justify-between group transition-all duration-200"
                      >
                        <div className="flex items-center gap-2 truncate mr-2">
                          <svg className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <line x1="3" y1="9" x2="21" y2="9" />
                            <line x1="9" y1="21" x2="9" y2="9" />
                          </svg>
                          <span className="font-semibold text-slate-900 truncate">{cleanName}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] font-sans font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                            Active
                          </span>
                          <button
                            type="button"
                            onClick={() => setTableToDelete(tbl)}
                            title={`Remove table ${cleanName}`}
                            aria-label={`Remove table ${cleanName}`}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all active:scale-90"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Expandable Schema Blueprint Viewer */}
                {schemaOpen && (
                  <div className="flex flex-col gap-1.5 qr-animate-fade">
                    <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                      <span>Relational Schema Blueprint</span>
                      <span className="font-mono text-xs text-slate-400">SQL Schema</span>
                    </div>
                    <pre className="p-3.5 rounded-xl bg-slate-950 text-slate-300 font-mono text-xs leading-relaxed max-h-48 overflow-auto border border-slate-800 select-text">
                      {schema || "-- No blueprint metadata found."}
                    </pre>
                  </div>
                )}

                {/* Link to Schema Studio */}
                <Link
                  href="/schema-studio"
                  className="pt-2 text-xs font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-1.5 transition-colors border-t border-slate-100 group"
                >
                  <span>Build custom table architectures in Schema Studio</span>
                  <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </Link>
              </div>
            )}

          </aside>

          {/* ==============================================================
             MAIN WORKBENCH: QUERY COMPOSER, SQL IDE & RESULTS (8 Cols)
             ============================================================== */}
          <section className="lg:col-span-8 flex flex-col gap-6">

            {/* Error Notification */}
            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 flex items-start gap-3 shadow-sm animate-fade-in">
                <svg className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="text-xs leading-relaxed">
                  <strong className="font-semibold block text-sm mb-0.5">Query Processing Error</strong>
                  {error}
                </div>
              </div>
            )}

            {/* Query Composer Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <label htmlFor="user-query" className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Natural Language Prompt
                </label>
                <span className="text-[11px] font-mono text-slate-400">
                  {hasDatasets ? "Schema connected" : "Awaiting dataset"}
                </span>
              </div>

              {/* Textarea */}
              <textarea
                id="user-query"
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerateSql();
                  }
                }}
                disabled={loading}
                placeholder={
                  hasDatasets
                    ? "Ask any question about your data (e.g. 'Show monthly revenue grouped by region in descending order')"
                    : "Upload a CSV or Excel file on the left to start asking questions about your data..."
                }
                className="w-full p-4 rounded-xl border border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 transition-all outline-none font-sans text-sm text-slate-900 placeholder-slate-400 resize-none leading-relaxed"
              />

              {/* Sample Queries Suggestions */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                  Try asking:
                </span>
                {EXAMPLE_QUERIES.map((eg, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setQuestion(eg)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200/80 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 text-[11px] text-slate-600 hover:text-indigo-700 transition-colors"
                  >
                    {eg}
                  </button>
                ))}
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
                <span className="text-[11px] text-slate-400">
                  Press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px] text-slate-600">Enter</kbd> to generate · <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px] text-slate-600">Shift + Enter</kbd> for newline
                </span>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={loading || executing || (!question && !sql)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold transition-colors disabled:opacity-40"
                  >
                    Reset
                  </button>

                  <button
                    type="button"
                    onClick={handleGenerateSql}
                    disabled={loading || !question.trim()}
                    className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-2 disabled:opacity-40 hover:-translate-y-0.5 active:translate-y-0"
                  >
                    {loading ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Generating SQL…
                      </>
                    ) : (
                      <>
                        Generate SQL
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Generated SQL Code Studio Window */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
              
              {/* Window Header Bar */}
              <div className="px-5 py-3.5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-400 pl-2 border-l border-slate-800">
                    generated_query.sql
                  </span>
                  <span className="hidden sm:inline px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    READ-ONLY SELECT
                  </span>
                </div>

                {sql && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopySql}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-colors flex items-center gap-1.5"
                    >
                      {copied ? (
                        <>
                          <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleExecuteSql}
                      disabled={executing || loading}
                      className="px-3.5 py-1 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {executing ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Executing…
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                          Run SQL
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Code Surface */}
              <div className="qr-generated-sql flex bg-[#0c101c] p-4 font-mono text-sm leading-relaxed overflow-x-auto min-h-[140px]">
                {/* Line Numbers */}
                <div className="text-right text-slate-600 pr-4 select-none border-r border-slate-850/80 mr-4 flex flex-col font-mono text-xs">
                  {sqlLines.map((_, i) => (
                    <span key={i} className="h-6 leading-6 block text-slate-600">
                      {i + 1}
                    </span>
                  ))}
                </div>

                {/* Highlighted SQL */}
                <div className="flex-1 font-mono text-xs leading-6">
                  {sqlLines.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.trim().startsWith("--")
                          ? "text-slate-500 italic"
                          : "text-indigo-300 font-medium"
                      }
                    >
                      {line || " "}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Results Grid Card */}
              <div className="qr-results-card bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                    Query Results
                  </h3>

                  {executionMeta && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200">
                      {executionMeta.rowCount.toLocaleString()} rows · {executionMeta.durationMs}ms
                    </span>
                  )}
                </div>

                {rows.length > 0 && (
                  <button
                    type="button"
                    onClick={downloadCSV}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export CSV
                  </button>
                )}
              </div>

              {/* Table or Empty State */}
              {rows.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mb-3">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                      <line x1="9" y1="21" x2="9" y2="9" />
                    </svg>
                  </div>
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    No Records Loaded
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    Enter a natural language question above and click &quot;Run SQL&quot; to execute and view interactive records.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[380px] scrollbar-thin">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200 sticky top-0 z-10">
                        {Object.keys(rows[0]).map((key) => (
                          <th key={key} className="px-4 py-3 font-mono font-bold text-slate-600 uppercase tracking-wider text-[11px] whitespace-nowrap">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-4 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                              {val === null || val === undefined ? (
                                <span className="text-slate-400 italic">NULL</span>
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

            {/* Quality Assessment & Feedback */}
            {sql && (
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    SQL Quality Assessment
                  </h4>
                  {feedbackSubmitted && (
                    <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                      ✓ Feedback recorded
                    </span>
                  )}
                </div>

                {!feedbackChoice && !feedbackSubmitted && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-xs font-semibold text-slate-700">
                      Did this generated query accurately answer your question?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setFeedbackChoice("yes"); handleFeedbackHelpful(); }}
                        className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        Yes, Correct
                      </button>
                      <button
                        type="button"
                        onClick={() => setFeedbackChoice("no")}
                        className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        Needs Refinement
                      </button>
                    </div>
                  </div>
                )}

                {feedbackChoice === "no" && !feedbackSubmitted && (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col gap-3 animate-fade-in">
                    <label className="text-xs font-semibold text-slate-700">
                      Explain what needs adjustment (e.g. &quot;Join on account_id instead of user_id&quot; or &quot;Sort ascending instead&quot;)
                    </label>
                    <textarea
                      rows={2}
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Specify your correction..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-400"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setFeedbackChoice(null); setFeedbackText(""); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/60"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleFeedbackRefine}
                        disabled={loading || !feedbackText.trim()}
                        className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {loading ? "Regenerating…" : "Regenerate Query"}
                      </button>
                    </div>
                    {feedbackError && (
                      <p className="text-xs text-rose-600 font-semibold">{feedbackError}</p>
                    )}
                  </div>
                )}
              </div>
            )}

          </section>

        </div>

      </main>

      {/* Enterprise Private SLM Contact Modal */}
      {contactModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Private SLM & On-Premise Deployment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setContactModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Queryra Enterprise offers isolated, air-gapped deployments using quantized Small Language Models (Qwen 2.5 Coder, Llama 3) running directly inside your virtual private cloud (AWS, GCP, Azure) or local server cluster.
            </p>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2 text-xs text-slate-700">
              <div className="flex items-center gap-2 font-semibold">
                <span className="text-indigo-600">✓</span> Zero data egress to third-party AI APIs
              </div>
              <div className="flex items-center gap-2 font-semibold">
                <span className="text-indigo-600">✓</span> Custom fine-tuning on company domain schema
              </div>
              <div className="flex items-center gap-2 font-semibold">
                <span className="text-indigo-600">✓</span> Dedicated engineering support & SLA
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setContactModalOpen(false)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
              <a
                href="mailto:hello@queryra.dev?subject=Enterprise%20Private%20SLM%20Inquiry&body=Hello%20Queryra%20Team,%0A%0AWe%20are%20interested%20in%20a%20private%20SLM%20deployment%20for%20our%20infrastructure.%0A%0AOrganization:%0AEstimated%20Queries%20per%20Month:%0ACloud%20or%20On-Premise%20Preference:"
                className="w-full sm:w-auto px-5 py-2 rounded-xl text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors text-center shadow-sm"
              >
                Email Enterprise Team →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="relative z-10 max-w-[1440px] mx-auto px-6 py-8 mt-12 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
        <div>Queryra Developer Platform · Cloud LLM Active</div>
        <div className="flex items-center gap-4">
          <Link href="/schema-studio" className="hover:text-slate-600 transition-colors">Schema Studio</Link>
          <Link href="/docs" className="hover:text-slate-600 transition-colors">CLI Docs</Link>
          <Link href="/resources" className="hover:text-slate-600 transition-colors">Resources</Link>
        </div>
      </footer>
    </div>
  );
}
