"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import SignOutButton from "./sign-out-button.jsx";

const API_BASE = "/SQG/content/v1";

const TEMPLATES = [
  {
    id: "orders",
    label: "Orders & Sales",
    description: "Transaction tracking with timestamps and amounts",
    sql: `CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT DEFAULT 'pending',
  region TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`,
  },
  {
    id: "customers",
    label: "Customer Accounts",
    description: "Account profiles, tier status and contact info",
    sql: `CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  subscription_tier TEXT DEFAULT 'starter',
  is_active BOOLEAN DEFAULT true
);`,
  },
  {
    id: "products",
    label: "Inventory Catalog",
    description: "Product inventory, SKU, and unit pricing",
    sql: `CREATE TABLE products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  unit_price NUMERIC(10, 2) NOT NULL,
  stock_quantity INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 10
);`,
  },
  {
    id: "events",
    label: "Product Analytics",
    description: "Event telemetry and user activity logs",
    sql: `CREATE TABLE user_events (
  event_id TEXT PRIMARY KEY,
  user_identifier TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_url TEXT,
  duration_seconds INTEGER,
  occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`,
  },
];

export default function SchemaStudioClient({ initialUser }) {
  const [sql, setSql] = useState(TEMPLATES[0].sql);
  const [validating, setValidating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [executionResult, setExecutionResult] = useState(null);
  const [error, setError] = useState("");
  const [activeTables, setActiveTables] = useState([]);
  const [activeSchema, setActiveSchema] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedTableDetails, setSelectedTableDetails] = useState(null);

  const textareaRef = useRef(null);

  const firstName = initialUser?.firstName || "Developer";

  // Load existing tables on mount
  useEffect(() => {
    fetchTables();
  }, []);

  async function fetchTables() {
    try {
      const res = await fetch(`${API_BASE}/tables`);
      if (res.ok) {
        const data = await res.json();
        setActiveTables(data.tables || []);
      }
      const schemaRes = await fetch(`${API_BASE}/schema`);
      if (schemaRes.ok) {
        const sData = await schemaRes.json();
        setActiveSchema(sData.schema_text || "");
      }
    } catch {
      // Ignored for initial load
    }
  }

  // -------- Table Deletion State --------
  const [tableToDelete, setTableToDelete] = useState(null);
  const [deletingTable, setDeletingTable] = useState(false);
  const [tableActionMessage, setTableActionMessage] = useState("");

  async function handleDeleteTable(tableName) {
    if (!tableName) return;
    setDeletingTable(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/delete-table`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to remove table.");
      setActiveTables(data.tables || []);
      setActiveSchema(data.schema_text || "");
      const cleanName = tableName.replace(/^qr_[a-f0-9]+_/, "");
      setTableActionMessage(`Table "${cleanName}" removed from workspace.`);
      setTimeout(() => setTableActionMessage(""), 4000);
      setTableToDelete(null);
      if (selectedTableDetails === tableName) {
        setSelectedTableDetails(null);
      }
    } catch (err) {
      setError(err.message || "Failed to remove table.");
    } finally {
      setDeletingTable(false);
    }
  }

  // Handle template selection
  function applyTemplate(template) {
    setSql(template.sql);
    setValidationResult(null);
    setExecutionResult(null);
    setError("");
  }

  // Handle SQL Validation
  async function handleValidate() {
    if (!sql.trim()) {
      setError("Please write or paste a CREATE TABLE statement.");
      return;
    }

    setValidating(true);
    setError("");
    setValidationResult(null);
    setExecutionResult(null);

    try {
      const res = await fetch(`${API_BASE}/schema-studio/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Validation failed.");
      }

      setValidationResult(data);
    } catch (err) {
      setError(err.message || "Failed to validate SQL statement.");
    } finally {
      setValidating(false);
    }
  }

  // Handle Table Deployment
  async function handleDeploy() {
    if (!sql.trim()) {
      setError("Please write or paste a CREATE TABLE statement.");
      return;
    }

    setExecuting(true);
    setError("");
    setExecutionResult(null);

    try {
      const res = await fetch(`${API_BASE}/schema-studio/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Execution failed.");
      }

      setExecutionResult(data);
      setValidationResult(null);
      await fetchTables();
    } catch (err) {
      setError(err.message || "Failed to execute table creation.");
    } finally {
      setExecuting(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const lines = sql.split("\n");

  return (
    <div className="qr-workspace-shell min-h-screen bg-[#f8f9fc] text-[#1c1d22] font-sans antialiased selection:bg-indigo-500/15">
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
                queryra<span>.</span>
              </span>
            </Link>

            {/* Navigation Tabs */}
            <nav className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl border border-slate-200/60 shadow-inner">
              <Link
                href="/workspace"
                className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/60 active:scale-95 transition-all duration-200 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-slate-500 group-hover:text-slate-900 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Query Workspace
              </Link>
              <span className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold bg-white text-indigo-600 shadow-sm border border-slate-200/60 flex items-center gap-2 transition-all duration-200 cursor-default">
                <svg className="w-4 h-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                Schema Studio
              </span>
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
              {firstName.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs font-semibold text-slate-700 hidden sm:inline">
              {firstName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Main Studio Area */}
      <main className="relative z-10 max-w-[1440px] mx-auto px-6 py-8">
        
        {/* Studio Hero Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/80">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold tracking-wider uppercase mb-2">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              TABLE DESIGN
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Schema Studio
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Write a table definition, check it, then deploy it to your workspace.
            </p>
          </div>

          {/* Quick Stat Pill */}
          <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200/80 shadow-sm self-start md:self-auto">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              {activeTables.length}
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                Active Tables
              </div>
              <div className="text-[11px] text-slate-500">
                {activeTables.length === 0 ? "No tables deployed yet" : "Ready for natural language query"}
              </div>
            </div>
          </div>
        </div>

        {/* Studio Grid: 8 Cols Editor, 4 Cols Inspector & Templates */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: SQL Editor (8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-6">

            {/* Template Presets Bar */}
            <div className="qr-blueprints bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold tracking-wider text-slate-700 uppercase flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Starter Architecture Blueprints
                </span>
                <span className="text-xs text-slate-500 font-medium">Click to load into editor</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => applyTemplate(tmpl)}
                    className="p-3.5 text-left rounded-xl border border-slate-200/80 hover:border-indigo-300 hover:bg-indigo-50/40 active:scale-95 transition-all duration-200 group flex flex-col justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {tmpl.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                        {tmpl.description}
                      </div>
                    </div>
                    <span className="text-xs text-indigo-600 font-semibold mt-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Load blueprint →
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* SQL Blueprint Editor Container */}
            <div className="qr-schema-editor-shell bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
              
              {/* Window Header */}
              <div className="px-5 py-3.5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-400 pl-2 border-l border-slate-800">
                    schema_blueprint.sql
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-colors flex items-center gap-1.5 active:scale-95"
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
                    onClick={() => { setSql(""); setValidationResult(null); setExecutionResult(null); }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-colors active:scale-95"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Code Surface */}
              <div className="qr-schema-code-area relative flex bg-[#0c101c] p-5 font-mono text-sm leading-relaxed overflow-x-auto min-h-[340px]">
                {/* Line Numbers */}
                <div className="text-right text-slate-600 pr-4 select-none border-r border-slate-850/80 mr-4 flex flex-col font-mono text-xs">
                  {lines.map((_, i) => (
                    <span key={i} className="h-6 leading-6 block text-slate-600">
                      {i + 1}
                    </span>
                  ))}
                </div>

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={sql}
                  onChange={(e) => {
                    setSql(e.target.value);
                    setError("");
                  }}
                  spellCheck="false"
                  placeholder="CREATE TABLE example (&#10;  id INTEGER PRIMARY KEY,&#10;  name TEXT NOT NULL&#10;);"
                  className="flex-1 w-full bg-transparent text-slate-100 placeholder-slate-600 outline-none resize-none font-mono text-sm leading-6 border-0 focus:ring-0 p-0"
                  rows={Math.max(12, lines.length)}
                />
              </div>

              {/* Toolbar Footer Actions */}
              <div className="p-4 bg-slate-950/90 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-indigo-400" />
                  <span>SQL table definition · <code className="text-indigo-300 font-mono">CREATE TABLE</code></span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleValidate}
                    disabled={validating || executing || !sql.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all flex items-center gap-2 disabled:opacity-50 active:scale-95"
                  >
                    {validating ? (
                      <span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    Verify Blueprint
                  </button>

                  <button
                    type="button"
                    onClick={handleDeploy}
                    disabled={executing || validating || !sql.trim()}
                    className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/30 transition-all flex items-center gap-2 disabled:opacity-50 hover:-translate-y-0.5 active:scale-95"
                  >
                    {executing ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Constructing Table…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        Provision Table
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 flex items-start gap-3 shadow-sm animate-fade-in">
                <svg className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="text-xs leading-relaxed">
                  <strong className="font-semibold block text-sm mb-0.5">Validation or Execution Error</strong>
                  {error}
                </div>
              </div>
            )}

            {/* Validation Success Card */}
            {validationResult && (
              <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 shadow-sm animate-fade-in">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">
                      ✓
                    </div>
                    <span className="text-sm font-bold text-emerald-900">
                      Valid Schema Definition
                    </span>
                  </div>
                  <span className="text-xs font-mono bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-md font-semibold">
                    Table: {validationResult.tableName}
                  </span>
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed mb-3">
                  All syntax and security checks passed. The statement qualifies as a safe isolated DDL operation.
                </p>
                <div className="bg-white/80 rounded-xl p-3 border border-emerald-200/60">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Detected Columns ({validationResult.columns?.length || 0})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {validationResult.columns?.map((col, idx) => (
                      <span key={idx} className="px-2.5 py-1 rounded-lg bg-emerald-100/60 text-emerald-900 text-xs font-mono">
                        <strong className="text-emerald-950">{col.name}</strong>: {col.data_type}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Execution Success Card */}
            {executionResult && (
              <div className="p-5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950 shadow-sm animate-fade-in">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">
                      ✓
                    </div>
                    <span className="text-sm font-bold text-indigo-900">
                      Table Successfully Created & Deployed!
                    </span>
                  </div>
                  <Link
                    href="/workspace"
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-1.5"
                  >
                    Query in Workspace →
                  </Link>
                </div>
                <p className="text-xs text-indigo-800 leading-relaxed mb-3">
                  Target table <code className="font-mono font-bold text-indigo-950 bg-indigo-100 px-1.5 py-0.5 rounded">{executionResult.logical_name || executionResult.table_name}</code> was registered in your workspace catalog with Row-Level Security active.
                </p>
                <div className="bg-white/80 rounded-xl p-3.5 border border-indigo-200/60 font-mono text-xs text-slate-700 max-h-40 overflow-y-auto">
                  <pre className="whitespace-pre-wrap">{executionResult.schema_text}</pre>
                </div>
              </div>
            )}

          </div>

          {/* Right Column: Security Checklist & Deployed Tables (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-6">

            {/* Security & Architecture Guardrails Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                <svg className="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                Security & Architecture Guardrails
              </div>
              <ul className="space-y-2.5 text-xs text-slate-600">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>CREATE TABLE only:</strong> Modifying commands (DROP, ALTER, TRUNCATE, DELETE) are automatically blocked.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Workspace RLS Enforced:</strong> Each created table is strictly isolated to your authenticated account.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>AST Verified:</strong> Queries are structurally inspected and validated before reaching the analytical database.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Instant Natural Language Querying:</strong> Deployed tables immediately become accessible in your Query Workspace.</span>
                </li>
              </ul>
            </div>

            {/* Currently Deployed Tables Directory */}
            <div className="qr-studio-table-panel bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                  Workspace Tables ({activeTables.length})
                </h2>
                <button
                  type="button"
                  onClick={fetchTables}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  Refresh
                </button>
              </div>

              {/* Table Action Message */}
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

              {activeTables.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl">
                  <p className="text-xs font-semibold text-slate-600">No tables created yet</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Deploy a schema using the editor or upload a CSV in the workspace.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                  {activeTables.map((tableName) => {
                    // Strip workspace prefix for friendly view
                    const friendlyName = tableName.replace(/^qr_[a-f0-9]+_/, "");
                    const isSelected = selectedTableDetails === tableName;
                    const isDeletingThis = tableToDelete === tableName;

                    if (isDeletingThis) {
                      return (
                        <div
                          key={tableName}
                          className="p-3 rounded-xl bg-rose-50 border border-rose-200/80 text-xs flex flex-col gap-2 qr-animate-fade"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-rose-900">
                              Remove table &quot;{friendlyName}&quot;?
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
                              onClick={() => handleDeleteTable(tableName)}
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
                        key={tableName}
                        className={`qr-studio-table-row p-3 rounded-xl border text-xs transition-all ${
                          isSelected
                            ? "bg-indigo-50/60 border-indigo-200"
                            : "bg-slate-50/70 border-slate-200/70 hover:bg-slate-100/70"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 truncate mr-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                            <strong className="font-mono text-slate-800 text-xs truncate">
                              {friendlyName}
                            </strong>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setSelectedTableDetails(isSelected ? null : tableName)}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded hover:bg-indigo-50 transition-colors"
                            >
                              {isSelected ? "Hide" : "Inspect"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setTableToDelete(tableName)}
                              title={`Remove table ${friendlyName}`}
                              aria-label={`Remove table ${friendlyName}`}
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
                        <div className="text-[11px] text-slate-400 font-mono mt-1 truncate">
                          {tableName}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Schema Inspector Preview */}
              {activeSchema && (
                <div className="mt-2 pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Full Workspace Schema
                  </div>
                  <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[11px] font-mono leading-relaxed max-h-48 overflow-y-auto overflow-x-auto select-text">
                    {activeSchema}
                  </pre>
                </div>
              )}

              {/* Jump to Query Workspace */}
              <Link
                href="/workspace"
                className="mt-2 w-full py-2.5 px-4 rounded-xl text-center text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                Open Query Workspace
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            </div>

          </div>

        </div>

      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-[1440px] mx-auto px-6 py-8 mt-12 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
        <div>Queryra Developer Platform · Schema Studio</div>
        <div className="flex items-center gap-4">
          <Link href="/workspace" className="hover:text-slate-600 transition-colors">Workspace</Link>
          <Link href="/docs" className="hover:text-slate-600 transition-colors">Documentation</Link>
          <Link href="/resources" className="hover:text-slate-600 transition-colors">Resources</Link>
        </div>
      </footer>
    </div>
  );
}

