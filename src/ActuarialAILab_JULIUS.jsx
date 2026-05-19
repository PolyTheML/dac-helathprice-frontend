import { useState, useRef, useEffect, useCallback } from "react";

const API = "https://dac-healthprice-api.onrender.com";

// ── Colors (Professional Dark Theme) ────────────────────────────────────────
const C = {
  dark: "#1a1a2e", darkLight: "#2a2a3e", bg: "#fafbfc",
  sidebar: "#ffffff", border: "#e8ecf1", borderLight: "#f0f2f5",
  navy: "#0d2b7a", navyLight: "#1a4fba", gold: "#f5a623", goldLight: "#fef3d6",
  text: "#1a1a2e", text2: "#5a6474", text3: "#8b95a5",
  white: "#ffffff", green: "#10b981", greenBg: "#ecfdf5",
  red: "#ef4444", redBg: "#fef2f2", blue: "#3b82f6", blueBg: "#eff6ff",
};

const SUGGESTIONS = [
  { label: "Clean & prepare data", prompt: "Clean this dataset for actuarial modeling...", color: "#8b5cf6" },
  { label: "Exploratory data analysis", prompt: "Perform comprehensive EDA...", color: "#3b82f6" },
  { label: "Frequency model", prompt: "Build a Poisson GLM frequency model...", color: "#10b981" },
  { label: "Severity model", prompt: "Build severity models...", color: "#f59e0b" },
  { label: "Full pricing", prompt: "Build complete frequency-severity pricing...", color: "#ec4899" },
  { label: "Experience study", prompt: "Perform Actual vs Expected analysis...", color: "#06b6d4" },
];

export default function ActuarialAILabJulius() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [fileMeta, setFileMeta] = useState(null);
  const [preview, setPreview] = useState(null);
  const [currentReport, setCurrentReport] = useState(null);
  const [showReport, setShowReport] = useState(false);

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  // ── Send Message ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (customPrompt) => {
    const msg = customPrompt || input.trim();
    if (!msg || loading) return;
    if (!customPrompt) setInput("");

    setMessages(prev => [...prev, { id: Date.now(), role: "user", content: msg }]);
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/v2/ailab/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, context: fileMeta?.filename || "no file" }),
      });
      const data = await res.json();

      setMessages(prev => [...prev, {
        id: Date.now(),
        role: "assistant",
        content: data.response || "Analysis complete",
      }]);

      if (data.response) {
        setCurrentReport({
          title: "Analysis Report",
          content: data.response,
          timestamp: new Date().toLocaleString(),
        });
        setShowReport(true);
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "error", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, fileMeta]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Main UI (Julius Style 3-Column Layout) ──────────────────────────────
  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .fade-in { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* LEFT: STEPS / NAVIGATION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
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
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* CENTER: CHAT AREA */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: `1px solid ${C.border}` }}>
        {/* Header with Share Button */}
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
                <div style={{ maxWidth: "85%", padding: "12px 16px", borderRadius: 12, background: C.borderLight, fontSize: 14, lineHeight: 1.6 }}>
                  {msg.content}
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
          <div style={{ display: "flex", gap: 12 }}>
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
              onClick={() => sendMessage()}
              disabled={!fileMeta || loading || !input.trim()}
              style={{
                width: 44, height: 44, borderRadius: 10, background: fileMeta && input.trim() && !loading ? C.navy : C.borderLight,
                border: "none", color: C.white, cursor: "pointer", fontSize: 18, fontWeight: 600,
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* RIGHT: REPORT PANEL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {showReport && currentReport && (
        <div style={{ width: 340, background: C.white, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Report Header */}
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>Report</div>
            <button
              onClick={() => setShowReport(false)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.text2 }}
            >
              ✕
            </button>
          </div>

          {/* Report Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, marginBottom: 12 }}>
              {currentReport.title}
            </div>
            <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {currentReport.content}
            </div>
            <div style={{ fontSize: 11, color: C.text3, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.borderLight}` }}>
              Generated: {currentReport.timestamp}
            </div>
          </div>

          {/* Export Buttons */}
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
            <button
              onClick={() => alert("Export as PDF coming soon!")}
              style={{
                flex: 1, padding: "8px", borderRadius: 6, background: C.blue, color: C.white,
                border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
              }}
            >
              📥 Export PDF
            </button>
            <button
              onClick={() => alert("Export as Word coming soon!")}
              style={{
                flex: 1, padding: "8px", borderRadius: 6, background: C.gold, color: C.white,
                border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
              }}
            >
              📄 Export Word
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
