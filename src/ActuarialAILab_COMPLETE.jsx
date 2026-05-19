import { useState, useRef, useEffect, useCallback } from "react";

const API = "https://dac-healthprice-api.onrender.com";

// ── Supabase Configuration ──────────────────────────────────────────────────
const SUPABASE_URL = "https://xtdxrpfuidrebdbfvq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0ZHhycGZ1aWRyZWRiZmZ2cSIsInJvbGUiOiJhbm9uIiwiYXVkIjoiYXV0aGVudGljYXRlZCIsImlhdCI6MTcxNDc2MjAwMCwiZXhwIjoxNzQ2Mjk4MDAwfQ.sb_publishable_j66-v3uNKuF9pu0mmqMIIA_XSZ4_rML";

class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
  }
  async request(method, path, body = null) {
    const opts = {
      method,
      headers: { "apikey": this.key, "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${this.url}/rest/v1${path}`, opts);
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res.json();
  }
  insert(table, data) { return this.request("POST", `/${table}`, data); }
  select(table, query = "") { return this.request("GET", `/${table}${query}`); }
}
const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Colors ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#fafbfc", sidebar: "#ffffff", border: "#e8ecf1", borderLight: "#f0f2f5",
  navy: "#0d2b7a", navyLight: "#1a4fba", gold: "#f5a623", goldLight: "#fef3d6",
  text: "#1a1a2e", text2: "#5a6474", text3: "#8b95a5",
  white: "#ffffff", green: "#10b981", greenBg: "#ecfdf5",
  red: "#ef4444", redBg: "#fef2f2", blue: "#3b82f6", blueBg: "#eff6ff",
  codeBg: "#1e1e2e", codeText: "#cdd6f4",
};

// ── Report Validation ──────────────────────────────────────────────────────
const REQUIRED_SECTIONS = [
  { name: "Summary", minWords: 100, description: "Executive overview" },
  { name: "Findings", minWords: 50, description: "Key discoveries" },
  { name: "Methodology", minWords: 100, description: "Technical approach" },
  { name: "Recommendations", minWords: 50, description: "Actionable insights" },
];

function validateReport(report) {
  const issues = [];
  const warnings = [];

  if (!report.title || report.title.trim().length < 5) {
    issues.push("❌ Title is missing or too short");
  }

  REQUIRED_SECTIONS.forEach(section => {
    const content = report[section.name.toLowerCase()] || "";
    const words = content.trim().split(/\s+/).length;
    if (words < section.minWords) {
      warnings.push(`⚠️ ${section.name}: Only ${words} words (min ${section.minWords})`);
    }
  });

  return { valid: issues.length === 0, issues, warnings, score: 100 - (issues.length * 20 + warnings.length * 5) };
}

// ── Suggestions ─────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { label: "Clean & prepare data", prompt: "Clean this dataset for actuarial modeling...", color: "#8b5cf6" },
  { label: "Exploratory data analysis", prompt: "Perform comprehensive EDA...", color: "#3b82f6" },
  { label: "Frequency model", prompt: "Build a Poisson GLM frequency model...", color: "#10b981" },
  { label: "Severity model", prompt: "Build severity models...", color: "#f59e0b" },
  { label: "Full pricing", prompt: "Build complete frequency-severity pricing...", color: "#ec4899" },
  { label: "Experience study", prompt: "Perform Actual vs Expected analysis...", color: "#06b6d4" },
];

// ── Utility Functions ───────────────────────────────────────────────────────
function extractCodeBlocks(text) {
  const blocks = [];
  const regex = /```python\n?([\s\S]*?)```/g;
  let m;
  while ((m = regex.exec(text)) !== null) blocks.push(m[1].trim());
  return blocks;
}

function removeCodeBlocks(text) {
  return text.replace(/```python\n?[\s\S]*?```/g, "").trim();
}

function parseOutput(stdout) {
  if (!stdout) return [];
  const lines = stdout.split("\n");
  const blocks = [];
  let tableLines = [];
  let textLines = [];

  const flushText = () => { if (textLines.length) { blocks.push({ type: "text", content: textLines.join("\n") }); textLines = []; } };
  const flushTable = () => { if (tableLines.length) { blocks.push({ type: "table", content: tableLines.join("\n") }); tableLines = []; } };

  for (const line of lines) {
    const isTableLine = (line.includes("  ") && line.trim().split(/\s{2,}/).length >= 3) || line.includes("|");
    if (isTableLine && line.trim()) {
      flushText();
      tableLines.push(line);
    } else {
      flushTable();
      textLines.push(line);
    }
  }
  flushText();
  flushTable();
  return blocks;
}

function OutputTable({ content }) {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length < 2) return <pre style={{ fontSize: 13, color: C.text2, margin: 0 }}>{content}</pre>;

  const rows = lines.map(l => l.trim().split(/\s{2,}|\s*\|\s*/));
  return (
    <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}`, margin: "8px 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.borderLight }}>
            {rows[0].map((cell, i) => (
              <th key={i} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: C.navy, borderBottom: `2px solid ${C.border}` }}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? C.white : C.bg }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: "9px 16px", borderBottom: `1px solid ${C.borderLight}`, color: C.text }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Save to Supabase ────────────────────────────────────────────────────────
async function saveToSupabase(report, fileName) {
  try {
    if (!report) {
      console.warn("⚠️ Missing report for Supabase save");
      return null;
    }
    const entry = {
      timestamp: new Date().toISOString(),
      filename: fileName || "analysis",
      title: report.title || "Untitled",
      summary: report.summary || "",
      findings: JSON.stringify(report.findings || []),
      report_json: JSON.stringify(report || {}),
    };
    const result = await supabase.insert("ailab_history", entry);
    return result;
  } catch (e) {
    console.error("❌ Supabase save failed:", e.message);
    return null;
  }
}

async function loadSupabaseHistory() {
  try {
    const data = await supabase.select("ailab_history", "?order=timestamp.desc&limit=50");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("⚠️ Supabase history load failed:", e.message);
    return [];
  }
}

// ── MAIN COMPONENT ──────────────────────────────────────────────────────
export default function ActuarialAILabComplete() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [fileMeta, setFileMeta] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showCodeFor, setShowCodeFor] = useState({});
  const [currentReport, setCurrentReport] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [analysisHistory, setAnalysisHistory] = useState([]);

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    loadSupabaseHistory().then(hist => {
      setAnalysisHistory(hist);
    });
  }, []);

  // ── File Upload ─────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (selectedFile) => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append("file", selectedFile);
    try {
      const res = await fetch(`${API}/api/v2/ailab/upload`, { method: "POST", body: formData });
      const data = await res.json();
      setFile(selectedFile);
      setFileMeta(data.meta);
      setPreview(data.preview);
      setMessages([{ id: Date.now(), role: "system", type: "success", content: `✓ Uploaded: ${data.meta.filename}` }]);
    } catch (e) {
      setMessages([{ id: Date.now(), role: "system", type: "error", content: `Upload failed: ${e.message}` }]);
    }
  }, []);

  // ── Code Execution ──────────────────────────────────────────────────────
  const executeCode = useCallback(async (code, msgId) => {
    try {
      const res = await fetch(`${API}/api/v2/ailab/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        execution: { stdout: data.stdout, stderr: data.stderr, charts: data.charts || [], success: data.success },
        executed: true
      } : m));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        execution: { stdout: "", stderr: e.message, charts: [], success: false },
        executed: true
      } : m));
    }
  }, []);

  // ── Send Message ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (customPrompt) => {
    const msg = customPrompt || input.trim();
    if (!msg || loading) return;
    if (!customPrompt) setInput("");

    const userMsgId = Date.now();
    setMessages(prev => [...prev, { id: userMsgId, role: "user", content: msg }]);
    setLoading(true);

    try {
      const history = messages.filter(m => m.role === "user" || m.role === "assistant").slice(-10).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(`${API}/api/v2/ailab/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history, filename: fileMeta?.filename || "" })
      });
      const data = await res.json();
      const aiMsgId = Date.now() + 1;
      const codeBlocks = extractCodeBlocks(data.response);
      const explanation = removeCodeBlocks(data.response);

      const aiMsg = {
        id: aiMsgId,
        role: "assistant",
        content: data.response,
        explanation,
        codeBlocks,
        hasCode: codeBlocks.length > 0,
        executed: false,
        execution: null,
      };
      setMessages(prev => [...prev, aiMsg]);

      // Auto-execute code
      if (codeBlocks.length > 0) {
        const allCode = codeBlocks.join("\n\n");
        await executeCode(allCode, aiMsgId);
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: "assistant", explanation: `Error: ${e.message}`, content: "", codeBlocks: [] }]);
    }
    setLoading(false);
  }, [input, messages, fileMeta, executeCode, loading]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Copy to Clipboard ──────────────────────────────────────────────────
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert("✓ Copied to clipboard!");
  };

  // ── Regenerate Analysis ────────────────────────────────────────────────
  const regenerateAnalysis = () => {
    if (messages.length > 0) {
      const userMsg = messages.find(m => m.role === "user")?.content;
      if (userMsg) {
        sendMessage(userMsg);
      }
    }
  };

  // ── Save to History ────────────────────────────────────────────────────
  const saveToHistory = async () => {
    if (currentReport && fileMeta) {
      try {
        await saveToSupabase(currentReport, fileMeta.filename);
        setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "success", content: "✅ Report saved to history" }]);
      } catch (e) {
        setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "error", content: `Failed to save: ${e.message}` }]);
      }
    }
  };

  // ── Report Generation from Analysis ────────────────────────────────────
  const generateReportFromAnalysis = useCallback((executionResults) => {
    const report = {
      title: "Analysis Report",
      timestamp: new Date().toLocaleString(),
      findings: [],
      summary: "",
    };

    if (executionResults.stdout) {
      const lines = executionResults.stdout.split("\n");
      lines.slice(0, 10).forEach(line => {
        if (line.trim() && !line.startsWith("  ")) {
          report.findings.push(line.trim());
        }
      });
    }

    if (report.findings.length > 0) {
      report.summary = report.findings.slice(0, 3).join(" ");
    }

    return report;
  }, []);

  // ── Update Report when execution completes ─────────────────────────────
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && lastMsg.executed && lastMsg.execution) {
      const newReport = generateReportFromAnalysis(lastMsg.execution);
      setCurrentReport(newReport);
      setShowReport(true);
    }
  }, [messages, generateReportFromAnalysis]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .fade-in { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* LEFT: SIDEBAR ─────────────────────────────────────────────────────────── */}
      <div style={{ width: 200, background: C.sidebar, borderRight: `1px solid ${C.border}`, padding: 20, overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginBottom: 24 }}>
          🧬 AI Lab
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 10, background: C.navy, color: C.white,
            border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 24,
          }}
        >
          + New Analysis
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={e => uploadFile(e.target.files[0])} />

        <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, textTransform: "uppercase", marginBottom: 12 }}>
          SUGGESTIONS
        </div>

        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            onClick={() => fileMeta && sendMessage(s.prompt)}
            disabled={!fileMeta}
            style={{
              width: "100%", padding: "10px 12px", marginBottom: 8, borderRadius: 8,
              background: fileMeta ? C.white : C.borderLight, border: `1px solid ${C.border}`,
              cursor: fileMeta ? "pointer" : "not-allowed", fontSize: 12, color: C.text, transition: "all 0.2s",
              opacity: fileMeta ? 1 : 0.6,
            }}
            onMouseEnter={e => fileMeta && (e.currentTarget.style.background = C.borderLight)}
            onMouseLeave={e => fileMeta && (e.currentTarget.style.background = C.white)}
          >
            {s.label}
          </button>
        ))}

        {fileMeta && (
          <div style={{ marginTop: 24, padding: "12px 14px", borderRadius: 10, background: C.greenBg, border: `1px solid ${C.green}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.green, marginBottom: 4 }}>✓ FILE LOADED</div>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{fileMeta.filename}</div>
            <div style={{ fontSize: 11, color: C.text2 }}>{fileMeta.rows?.toLocaleString()} rows</div>
          </div>
        )}

        {analysisHistory.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, textTransform: "uppercase", marginBottom: 12 }}>
              HISTORY ({analysisHistory.length})
            </div>
            {analysisHistory.slice(0, 5).map((entry, i) => (
              <div key={i} style={{ padding: 8, marginBottom: 6, borderRadius: 6, background: C.borderLight, fontSize: 11, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = C.border}
                onMouseLeave={e => e.currentTarget.style.background = C.borderLight}>
                <div style={{ fontWeight: 600, color: C.text, marginBottom: 2 }}>{entry.title}</div>
                <div style={{ fontSize: 10, color: C.text3 }}>{new Date(entry.timestamp).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CENTER: CHAT AREA ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: `1px solid ${C.border}` }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>Analysis Chat</div>
          <button
            onClick={() => alert("Share functionality coming soon!")}
            style={{
              padding: "8px 14px", borderRadius: 6, background: C.navy, color: C.white,
              border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
            }}
          >
            Share
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px", background: C.white }}>
          {messages.length === 0 && !fileMeta && (
            <div style={{ textAlign: "center", paddingTop: "20vh" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.navy, marginBottom: 10 }}>Upload Data to Start</div>
              <div style={{ fontSize: 14, color: C.text2 }}>Choose a CSV or Excel file to begin analysis</div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} style={{ marginBottom: 16 }} className="fade-in">
              {msg.role === "user" && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{
                    maxWidth: "70%", padding: "12px 16px", borderRadius: "16px 16px 4px 16px",
                    background: C.navy, color: C.white, fontSize: 14, lineHeight: 1.5,
                  }}>
                    {msg.content}
                  </div>
                </div>
              )}

              {msg.role === "assistant" && (
                <div style={{ maxWidth: "85%" }}>
                  <div style={{ padding: "12px 16px", borderRadius: 12, background: C.borderLight, fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
                    {msg.explanation || msg.content}
                  </div>

                  {/* Copy & Regenerate Buttons */}
                  {(msg.explanation || msg.content) && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <button
                        onClick={() => copyToClipboard(msg.explanation || msg.content)}
                        style={{
                          padding: "6px 12px", borderRadius: 6, background: C.borderLight, border: "none", color: C.text2, fontSize: 12, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s"
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = C.border; e.currentTarget.style.color = C.text; }}
                        onMouseLeave={e => { e.currentTarget.style.background = C.borderLight; e.currentTarget.style.color = C.text2; }}
                      >
                        📋 Copy
                      </button>
                      <button
                        onClick={regenerateAnalysis}
                        style={{
                          padding: "6px 12px", borderRadius: 6, background: C.borderLight, border: "none", color: C.text2, fontSize: 12, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s"
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = C.border; e.currentTarget.style.color = C.text; }}
                        onMouseLeave={e => { e.currentTarget.style.background = C.borderLight; e.currentTarget.style.color = C.text2; }}
                      >
                        🔄 Regenerate
                      </button>
                    </div>
                  )}

                  {/* Code Blocks */}
                  {msg.hasCode && (
                    <>
                      <button
                        onClick={() => setShowCodeFor(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                        style={{
                          padding: "6px 12px", borderRadius: 6, background: C.borderLight, border: "none", color: C.text2, fontSize: 12, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 6, marginBottom: 8
                        }}
                      >
                        &lt;/&gt; {showCodeFor[msg.id] ? "Hide" : "View"} code
                      </button>
                      {showCodeFor[msg.id] && msg.codeBlocks?.map((code, ci) => (
                        <div key={ci} style={{ borderRadius: 12, overflow: "hidden", marginBottom: 12, border: `1px solid #2d2d3f`, background: C.codeBg }}>
                          <div style={{ padding: "8px 16px", background: "#161622", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: "#6b6b8a", fontFamily: "monospace" }}>Python</span>
                            <button
                              onClick={() => navigator.clipboard.writeText(code)}
                              style={{ padding: "3px 10px", borderRadius: 5, background: "transparent", border: `1px solid #2d2d3f`, color: "#8b8baa", fontSize: 11, cursor: "pointer" }}
                            >
                              Copy
                            </button>
                          </div>
                          <pre style={{ padding: "14px 16px", margin: 0, color: C.codeText, overflowX: "auto", fontFamily: "monospace", fontSize: 11, lineHeight: 1.5 }}>{code}</pre>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Execution Results */}
                  {msg.execution && (
                    <div style={{ marginTop: 8 }}>
                      {msg.execution.stdout && (
                        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 12, padding: 14 }}>
                          {parseOutput(msg.execution.stdout).map((block, bi) => (
                            <div key={bi}>
                              {block.type === "table" ? (
                                <OutputTable content={block.content} />
                              ) : (
                                <pre style={{ fontSize: 13, color: C.text2, margin: "4px 0", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{block.content}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.execution.stderr && !msg.execution.success && (
                        <div style={{ padding: "12px 16px", borderRadius: 10, background: C.redBg, border: `1px solid #fecaca`, marginBottom: 12 }}>
                          <pre style={{ fontSize: 12, color: C.red, margin: 0, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{msg.execution.stderr}</pre>
                        </div>
                      )}

                      {msg.execution.charts?.length > 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: msg.execution.charts.length === 1 ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 8 }}>
                          {msg.execution.charts.map((chart, ci) => (
                            <div key={ci} style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                              <img src={chart.data} alt={chart.filename} style={{ width: "100%", display: "block", cursor: "pointer" }}
                                onClick={() => {
                                  const w = window.open();
                                  w.document.write(`<img src="${chart.data}" style="max-width:100%;background:#fff" />`);
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {msg.role === "system" && (
                <div style={{
                  padding: "12px 16px", borderRadius: 8, fontSize: 13,
                  background: msg.type === "error" ? C.redBg : msg.type === "success" ? C.greenBg : C.blueBg,
                  color: msg.type === "error" ? C.red : msg.type === "success" ? C.green : C.blue,
                  border: `1px solid ${msg.type === "error" ? C.red : msg.type === "success" ? C.green : C.blue}`,
                }}>
                  {msg.content}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ display: "inline-flex", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.text3, animation: "pulse 1.5s infinite" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.text3, animation: "pulse 1.5s infinite 0.3s" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.text3, animation: "pulse 1.5s infinite 0.6s" }} />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, background: C.white }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={fileMeta ? "Ask about your analysis..." : "Upload a file first..."}
              disabled={!fileMeta}
              rows={1}
              style={{
                flex: 1, padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.border}`,
                fontSize: 14, fontFamily: "inherit", resize: "none", minHeight: 44, maxHeight: 120,
                background: fileMeta ? C.white : C.borderLight, color: C.text,
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: 44, height: 44, borderRadius: 10, background: C.borderLight, border: "none", color: C.text3,
                cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s"
              }}
              onMouseEnter={e => { e.currentTarget.style.background = C.gold; e.currentTarget.style.color = C.white; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.borderLight; e.currentTarget.style.color = C.text3; }}
              title="Upload file"
            >
              📎
            </button>
            <button
              onClick={() => sendMessage()}
              disabled={!fileMeta || loading || !input.trim()}
              style={{
                width: 44, height: 44, borderRadius: 10, background: fileMeta && input.trim() && !loading ? C.navy : C.borderLight,
                border: "none", color: C.white, cursor: "pointer", fontSize: 18, fontWeight: 600, transition: "all 0.2s"
              }}
              onMouseEnter={e => fileMeta && input.trim() && !loading && (e.currentTarget.style.background = C.navyLight)}
              onMouseLeave={e => fileMeta && input.trim() && !loading && (e.currentTarget.style.background = C.navy)}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: REPORT PANEL ───────────────────────────────────────────────────── */}
      {showReport && currentReport && (
        <div style={{ width: 340, background: C.white, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>Report</div>
            <button
              onClick={() => setShowReport(false)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.text2 }}
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, marginBottom: 12 }}>
              {currentReport.title}
            </div>
            <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {currentReport.summary || "Analysis report generated"}
            </div>
            {currentReport.findings && currentReport.findings.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.navy, marginBottom: 6 }}>Findings:</div>
                {currentReport.findings.slice(0, 3).map((f, i) => (
                  <div key={i} style={{ fontSize: 11, color: C.text2, marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${C.gold}` }}>
                    • {f}
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: C.text3, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.borderLight}` }}>
              Generated: {currentReport.timestamp}
            </div>
          </div>

          {/* Export Buttons */}
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={saveToHistory}
              style={{
                width: "100%", padding: "8px", borderRadius: 6, background: C.green, color: C.white,
                border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
              }}
            >
              📜 Save
            </button>
            <button
              onClick={() => alert("PDF export coming soon!")}
              style={{
                width: "100%", padding: "8px", borderRadius: 6, background: C.blue, color: C.white,
                border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
              }}
            >
              📥 Export PDF
            </button>
          </div>
        </div>
      )}

      {/* Data Preview Panel (if no report) */}
      {!showReport && preview && (
        <div style={{ width: 340, background: C.white, borderLeft: `1px solid ${C.border}`, padding: "16px 20px", overflowY: "auto" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, marginBottom: 12 }}>
            Data Preview
          </div>
          {preview && preview.length > 0 && (
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {Object.keys(preview[0]).map(k => (
                    <th key={k} style={{ padding: "6px 0", textAlign: "left", fontWeight: 600, color: C.navy }}>
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    {Object.values(row).map((v, j) => (
                      <td key={j} style={{ padding: "6px 0", color: C.text2 }}>
                        {String(v).substring(0, 15)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
