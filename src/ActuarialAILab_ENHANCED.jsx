import { useState, useRef, useEffect, useCallback } from "react";

const API = "https://dac-healthprice-api.onrender.com";

// ── Supabase Configuration ──────────────────────────────────────────────────
const SUPABASE_URL = "https://xtdxrpfuidrebdbfvq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0ZHhycGZ1aWRyZWRiZmZ2cSIsInJvbGUiOiJhbm9uIiwiYXVkIjoiYXV0aGVudGljYXRlZCIsImlhdCI6MTcxNDc2MjAwMCwiZXhwIjoxNzQ2Mjk4MDAwfQ.sb_publishable_j66-v3uNKuF9pu0mmqMIIA_XSZ4_rML";

// Simple Supabase Client
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

// ── Colors (KEEP ORIGINAL - NO CHANGES) ──────────────────────────────────
const C = {
  bg: "#fafbfc", sidebar: "#ffffff", border: "#e8ecf1", borderLight: "#f0f2f5",
  navy: "#0d2b7a", navyLight: "#1a4fba", gold: "#f5a623", goldLight: "#fef3d6",
  text: "#1a1a2e", text2: "#5a6474", text3: "#8b95a5",
  white: "#ffffff", green: "#10b981", greenBg: "#ecfdf5",
  red: "#ef4444", redBg: "#fef2f2", blue: "#3b82f6", blueBg: "#eff6ff",
  codeBg: "#1e1e2e", codeText: "#cdd6f4",
  purple: "#8b5cf6", purpleBg: "#faf5ff", orange: "#f59e0b", orangeBg: "#fffbeb",
};

// ── Report Validation & Grammar Checking ───────────────────────────────────
const REQUIRED_SECTIONS = [
  { name: "Summary", minWords: 100, description: "Executive overview" },
  { name: "Findings", minWords: 50, description: "Key discoveries" },
  { name: "Methodology", minWords: 100, description: "Technical approach" },
  { name: "Recommendations", minWords: 50, description: "Actionable insights" },
];

function validateReport(report) {
  const issues = [];
  const warnings = [];

  // Check title
  if (!report.title || report.title.trim().length < 5) {
    issues.push("❌ Title is missing or too short");
  }

  // Check sections
  REQUIRED_SECTIONS.forEach(section => {
    const content = report[section.name.toLowerCase()] || "";
    const words = content.trim().split(/\s+/).length;
    if (words < section.minWords) {
      warnings.push(`⚠️ ${section.name}: Only ${words} words (min ${section.minWords})`);
    }
  });

  // Check for technical content
  const fullText = Object.values(report).join(" ").toLowerCase();
  const hasNumbers = /\d+[\.,]\d+|[$€¥£%]/.test(fullText);
  const hasTables = report.findings?.includes("table") || report.methodology?.includes("method");

  if (!hasNumbers) warnings.push("⚠️ No numeric data or metrics detected");
  if (!hasTables && !hasNumbers) warnings.push("⚠️ Missing charts or tables");

  // Grammar checks
  const grammarIssues = checkGrammar(fullText);
  warnings.push(...grammarIssues);

  return { valid: issues.length === 0, issues, warnings, score: 100 - (issues.length * 20 + warnings.length * 5) };
}

function checkGrammar(text) {
  const issues = [];
  const patterns = [
    { regex: /\b([A-Z]{2,})\s+([A-Z]{2,})\b/g, msg: "Possible acronym without explanation" },
    { regex: /\s{2,}/g, msg: "Multiple spaces detected" },
    { regex: /[a-z]\.[A-Z]/g, msg: "Missing space after period" },
    { regex: /\b(is|are)\s+(is|are)\b/gi, msg: "Duplicate word detected" },
  ];

  patterns.forEach(p => {
    if (p.regex.test(text)) issues.push(`⚠️ ${p.msg}`);
  });

  return issues;
}

// ── Actuarial Quick Actions ─────────────────────────────────────────────────
const SUGGESTIONS = [
  {
    id: "clean",
    label: "Clean & prepare data",
    purpose: "Prepare raw data for analysis",
    prompt: "Clean this dataset for actuarial modeling: handle missing values with appropriate imputation, remove duplicates, fix data types, cap outliers at the 99th percentile, and encode categorical variables. Show a before/after summary with data quality metrics.",
    color: "#8b5cf6",
    nextSteps: ["Exploratory data analysis", "Frequency model (Poisson GLM)"]
  },
  {
    id: "eda",
    label: "Exploratory data analysis",
    purpose: "Understand data distributions and relationships",
    prompt: "Perform comprehensive EDA: plot distributions for all numeric columns (use subplots), create a correlation heatmap, show value counts for categorical columns, and generate claim rate analysis by key risk factors. Save all charts to /tmp/ailab_output/. Use a clean actuarial style.",
    color: "#3b82f6",
    nextSteps: ["Frequency model (Poisson GLM)", "Severity model (Gamma GLM + GBR)"]
  },
  {
    id: "freq",
    label: "Frequency model (Poisson GLM)",
    purpose: "Predict claim occurrence/frequency",
    prompt: "Build a Poisson GLM frequency model to predict claim count/occurrence. Split data 80/20, fit the model, show coefficients with interpretation, calculate AUC-ROC and classification metrics. Plot the ROC curve and feature importance. Interpret from an actuarial pricing perspective.",
    color: "#10b981",
    nextSteps: ["Severity model (Gamma GLM + GBR)", "Full pricing (Freq x Sev)"]
  },
  {
    id: "severity",
    label: "Severity model (Gamma GLM + GBR)",
    purpose: "Predict claim amounts",
    prompt: "Build two severity models on claims with amount > 0: a Gamma GLM (actuarial standard) and a Gradient Boosting Regressor. Compare MAE, RMSE, R-squared. Plot actual vs predicted and residuals. Recommend which model to use for production pricing.",
    color: "#f59e0b",
    nextSteps: ["Full pricing (Freq x Sev)", "Experience study (A vs E)"]
  },
  {
    id: "pricing",
    label: "Full pricing (Freq x Sev)",
    purpose: "Calculate premiums from frequency and severity models",
    prompt: "Build a complete frequency-severity pricing pipeline: Poisson GLM for frequency, best severity model for cost. Calculate Expected Annual Cost = E[Frequency] x E[Severity]. Add expense loading (30%), risk margin (10%), and profit margin (5%). Show premium rating table by age group and risk class.",
    color: "#ec4899",
    nextSteps: ["Experience study (A vs E)", "Create report"]
  },
  {
    id: "experience",
    label: "Experience study (A vs E)",
    purpose: "Validate pricing against actual claims",
    prompt: "Perform Actual vs Expected analysis: calculate actual claim rates by age group, gender, and other risk factors. Compare against expected rates. Flag segments where A/E ratio deviates >10% from 1.0. Plot A/E ratios with confidence bands.",
    color: "#06b6d4",
    nextSteps: ["Create report", "Clean & prepare data"]
  },
];

// ── ENHANCED: Save to Microsoft Word (.docx) ──────────────────────────────
function saveAsWord(report, analysisStep) {
  const docContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Calibri', Arial, sans-serif; margin: 40px; line-height: 1.6; color: #1a1a2e; }
        h1 { color: #0d2b7a; border-bottom: 3px solid #f5a623; padding-bottom: 10px; font-size: 28px; }
        h2 { color: #1a4fba; margin-top: 20px; font-size: 18px; }
        table { border-collapse: collapse; width: 100%; margin: 15px 0; }
        th, td { border: 1px solid #e8ecf1; padding: 10px; text-align: left; }
        th { background-color: #f0f2f5; font-weight: bold; }
        .metadata { background-color: #fef3d6; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .section { margin: 20px 0; }
        .finding { padding: 10px; background: #f0f2f5; margin: 10px 0; border-left: 4px solid #0d2b7a; }
      </style>
    </head>
    <body>
      <h1>${report.title || analysisStep.label}</h1>

      <div class="metadata">
        <p><strong>Purpose:</strong> ${report.purpose || analysisStep.purpose}</p>
        <p><strong>Generated:</strong> ${report.timestamp}</p>
        <p><strong>Analysis Type:</strong> ${analysisStep.label}</p>
      </div>

      <h2>Summary</h2>
      <p>${report.summary || "Analysis completed successfully."}</p>

      <h2>Key Findings</h2>
      ${report.findings.length > 0 ?
        report.findings.map((f, i) => `<div class="finding">${i + 1}. ${f}</div>`).join('') :
        '<p>Analysis findings will appear here.</p>'
      }

      <h2>Executive Summary</h2>
      <p>This actuarial analysis was conducted using advanced statistical and machine learning methodologies. The results provide insights into claims patterns, risk factors, and pricing implications for the insurance portfolio.</p>

      <p><strong>Report generated by:</strong> DAC Actuarial AI Lab</p>
      <p><strong>Status:</strong> Draft - For Review and Discussion</p>
    </body>
    </html>
  `;

  const blob = new Blob([docContent], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().split('T')[0];
  link.download = `${analysisStep.id}_Report_${timestamp}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── NEW: Save to PDF ──────────────────────────────────────────────────────
function saveAsPDF(report, analysisStep) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Arial', sans-serif; margin: 40px; line-height: 1.6; color: #1a1a2e; }
        h1 { color: #0d2b7a; border-bottom: 3px solid #f5a623; padding-bottom: 10px; font-size: 28px; }
        h2 { color: #1a4fba; margin-top: 20px; font-size: 18px; }
        .metadata { background-color: #fef3d6; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .finding { padding: 10px; background: #f0f2f5; margin: 10px 0; border-left: 4px solid #0d2b7a; }
      </style>
    </head>
    <body>
      <h1>${report.title || analysisStep.label}</h1>
      <div class="metadata">
        <p><strong>Purpose:</strong> ${report.purpose || analysisStep.purpose}</p>
        <p><strong>Generated:</strong> ${report.timestamp}</p>
      </div>
      <h2>Key Findings</h2>
      ${report.findings.map((f, i) => `<div class="finding">${i + 1}. ${f}</div>`).join('')}
    </body>
    </html>
  `;

  const blob = new Blob([htmlContent], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().split('T')[0];
  link.download = `${analysisStep.id}_Report_${timestamp}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Report Generation ────────────────────────────────────────────────────
function generateReportFromAnalysis(analysisStep, executionResults) {
  const report = {
    title: analysisStep.label,
    purpose: analysisStep.purpose,
    timestamp: new Date().toLocaleString(),
    findings: [],
    summary: "",
    recommendations: [],
  };

  if (executionResults.stdout) {
    const lines = executionResults.stdout.split("\n");
    lines.slice(0, 10).forEach(line => {
      if (line.trim() && !line.startsWith("  ")) {
        report.findings.push(line.trim());
      }
    });
  }

  return report;
}

// ── Parse output ─────────────────────────────────────────────────────────
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

// ── Extract code blocks ──────────────────────────────────────────────────
function extractCodeBlocks(text) {
  if (!text || typeof text !== "string") return [];
  const blocks = [];
  const regex = /```python\n?([\s\S]*?)```/g;
  let m;
  while ((m = regex.exec(text)) !== null) blocks.push(m[1].trim());
  return blocks;
}

function removeCodeBlocks(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/```python\n?[\s\S]*?```/g, "").trim();
}

function renderMarkdown(text) {
  // Extreme defensive checks
  if (!text) return "";

  // Handle all non-string types
  let str = text;
  if (typeof str !== "string") {
    if (typeof str === "object") {
      // If it's an object, try to get a string representation
      try {
        str = str.toString ? str.toString() : JSON.stringify(str);
      } catch {
        str = "[Object]";
      }
    } else {
      str = String(str) || "";
    }
  }

  if (!str || typeof str !== "string" || str.trim() === "") return "";

  try {
    // Safely apply markdown transformations
    let result = str;

    // Protect against undefined at each step
    if (result && typeof result === "string") {
      result = result.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    }
    if (result && typeof result === "string") {
      result = result.replace(/\*(.*?)\*/g, "<em>$1</em>");
    }
    if (result && typeof result === "string") {
      result = result.replace(/`(.*?)`/g, `<code style="background:${C.borderLight};padding:2px 7px;border-radius:4px;font-size:12.5px;color:${C.navy}">$1</code>`);
    }
    if (result && typeof result === "string") {
      result = result.replace(/\n/g, "<br/>");
    }

    return result || "";
  } catch (e) {
    console.error("Markdown error:", e);
    try {
      return String(text).substring(0, 500) || "";
    } catch {
      return "[Error rendering content]";
    }
  }
}

// Safe wrapper for rendering
function safeRenderMarkdown(text) {
  try {
    return renderMarkdown(text);
  } catch (e) {
    console.error("Safe render failed:", e);
    return "[Content unavailable]";
  }
}

// ── Supabase History Management ──────────────────────────────────────────────
async function saveToSupabase(report, analysisStep, fileName) {
  try {
    if (!report || !analysisStep) {
      console.warn("⚠️ Missing report or analysisStep for Supabase save");
      return null;
    }
    const entry = {
      timestamp: new Date().toISOString(),
      filename: fileName || "analysis",
      title: report.title || analysisStep.label || "Untitled",
      summary: report.summary || "",
      findings: JSON.stringify(report.findings || []),
      purpose: analysisStep.purpose || "",
      analysis_type: analysisStep.label || "Unknown",
      report_json: JSON.stringify(report || {}),
    };
    const result = await supabase.insert("ailab_history", entry);
    console.log("✅ Saved to Supabase:", result);
    return result;
  } catch (e) {
    console.error("❌ Supabase save failed (non-critical):", e.message);
    return null;
  }
}

async function loadSupabaseHistory() {
  try {
    const data = await supabase.select("ailab_history", "?order=timestamp.desc&limit=50");
    console.log("✅ Loaded history from Supabase:", data?.length || 0, "entries");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("⚠️ Supabase history load failed (non-critical):", e.message);
    return [];
  }
}

// ── MAIN COMPONENT ──────────────────────────────────────────────────────
export default function ActuarialAILabEnhanced() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [fileMeta, setFileMeta] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showCodeFor, setShowCodeFor] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [currentReport, setCurrentReport] = useState(null);
  const [currentAnalysisStep, setCurrentAnalysisStep] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [analysisHistory, setAnalysisHistory] = useState([]);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Load History from Supabase ──────────────────────────────────────
  useEffect(() => {
    loadSupabaseHistory().then(hist => {
      setAnalysisHistory(hist);
      localStorage.setItem("ailab_history", JSON.stringify(hist));
    }).catch(e => console.warn("Could not load Supabase history:", e));
  }, []);

  // ── File Upload ─────────────────────────────────────────────────────
  const uploadFile = useCallback(async (selectedFile) => {
    if (!selectedFile) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", selectedFile);
    try {
      const res = await fetch(`${API}/api/v2/ailab/upload`, { method: "POST", body: formData });
      const data = await res.json();
      setFile(selectedFile);
      setFileMeta(data.meta);
      setPreview(data.preview);
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: "system",
        type: "file_uploaded",
        meta: data.meta,
        preview: data.preview,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "error", content: `Upload failed: ${e.message}` }]);
    }
    setUploading(false);
  }, []);

  // ── Code Execution with Report ──────────────────────────────────────
  const executeCode = useCallback(async (code, msgId, analysisStep) => {
    try {
      const res = await fetch(`${API}/api/v2/ailab/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      const report = generateReportFromAnalysis(analysisStep, data);

      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        execution: { stdout: data.stdout, stderr: data.stderr, charts: data.charts || [], success: data.success },
        executed: true,
        report: report,
      } : m));

      setCurrentReport(report);
      setCurrentAnalysisStep(analysisStep);
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        execution: { stdout: "", stderr: e.message, charts: [], success: false },
        executed: true
      } : m));
    }
  }, []);

  // ── Send Message ────────────────────────────────────────────────────
  const sendMessage = useCallback(async (customPrompt, analysisStep) => {
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
      const responseText = data.response || "Analysis complete";
      const codeBlocks = extractCodeBlocks(responseText);
      const explanation = removeCodeBlocks(responseText);

      const aiMsg = {
        id: aiMsgId,
        role: "assistant",
        content: responseText,
        explanation,
        codeBlocks,
        hasCode: codeBlocks.length > 0,
        executed: false,
        analysisStep: analysisStep,
      };
      setMessages(prev => [...prev, aiMsg]);

      if (codeBlocks.length > 0 && analysisStep) {
        const allCode = codeBlocks.join("\n\n");
        await executeCode(allCode, aiMsgId, analysisStep);
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

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) uploadFile(f);
  };

  // ── NEW: Copy to Clipboard ──────────────────────────────────────────
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert("✓ Copied to clipboard!");
  };

  // ── NEW: Regenerate Analysis ────────────────────────────────────────
  const regenerateAnalysis = () => {
    if (currentAnalysisStep && messages.length > 0) {
      const userMsg = messages.find(m => m.role === "user")?.content;
      if (userMsg) {
        sendMessage(userMsg, currentAnalysisStep);
      }
    }
  };

  // ── NEW: Save to History ────────────────────────────────────────────
  const saveToHistory = async () => {
    if (currentReport && fileMeta && currentAnalysisStep) {
      const historyEntry = {
        id: Date.now(),
        timestamp: new Date().toLocaleString(),
        filename: fileMeta.filename,
        title: currentReport.title,
        findings: currentReport.findings,
        purpose: currentReport.purpose,
      };
      setAnalysisHistory([historyEntry, ...analysisHistory]);
      // Save to Supabase
      try {
        await saveToSupabase(currentReport, currentAnalysisStep, fileMeta.filename);
        setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "success", content: "✅ Report saved to Supabase" }]);
      } catch (e) {
        setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "error", content: `Failed to save to Supabase: ${e.message}` }]);
      }
    }
  };

  // ── Report Validation Display ──────────────────────────────────────
  const showValidation = useCallback(() => {
    if (!currentReport) {
      setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "warning", content: "⚠️ No report to validate yet" }]);
      return;
    }
    try {
      const validation = validateReport(currentReport || {});
      const validationMsg = `📋 REPORT VALIDATION
Score: ${validation.score || 0}/100
Valid: ${validation.valid ? "✅ Yes" : "❌ No"}

Issues:
${validation.issues?.length > 0 ? validation.issues.join("\n") : "✅ No critical issues"}

Recommendations:
${validation.warnings?.length > 0 ? validation.warnings.join("\n") : "✅ Report looks good"}`;
      setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "info", content: validationMsg }]);
    } catch (e) {
      console.error("Validation error:", e);
      setMessages(prev => [...prev, { id: Date.now(), role: "system", type: "error", content: `Validation error: ${e.message}` }]);
    }
  }, [currentReport]);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <style>{`
        .ailab * { box-sizing: border-box; }
        .ailab-input:focus { outline: none; box-shadow: 0 0 0 3px rgba(13,43,122,0.08); }
        .ailab-suggestion { transition: all 0.2s; cursor: pointer; }
        .ailab-suggestion:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.08) !important; }
        .ailab-fade-in { animation: ailabFadeIn 0.35s ease-out; }
        @keyframes ailabFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .ailab-scrollbar::-webkit-scrollbar { width: 5px; }
        .ailab-scrollbar::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .chart-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 12px 0; }
        @media (max-width: 1024px) { .chart-grid { grid-template-columns: 1fr; } }
      `}</style>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* NEW: SIDEBAR NAVIGATION (Enhanced) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {sidebarOpen && (
        <div style={{ width: 220, background: C.white, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", padding: 16, overflowY: "auto" }} className="ailab-scrollbar">
          <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
            <span>🧬</span> AI Lab
          </div>

          <button onClick={() => fileInputRef.current?.click()} style={{ padding: "10px 14px", borderRadius: 10, background: C.navy, color: C.white, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 24, width: "100%" }}>
            + New Analysis
          </button>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, textTransform: "uppercase", marginBottom: 12 }}>Navigation</div>
            {[
              { icon: "📓", label: "Notebooks" },
              { icon: "📊", label: "Analysis" },
              { icon: "📁", label: "Data Files" },
              { icon: "⚙️", label: "Settings" }
            ].map((item, i) => (
              <div key={i} style={{ padding: "10px 12px", marginBottom: 6, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: C.text2, transition: "all 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = C.borderLight}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span>{item.icon}</span>
                {item.label}
              </div>
            ))}

            {/* HISTORY SECTION */}
            <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <button onClick={() => setShowHistory(!showHistory)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, background: C.borderLight, border: "none", color: C.text, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = C.border}
                onMouseLeave={e => e.currentTarget.style.background = C.borderLight}>
                <span>📜</span> History ({analysisHistory.length})
              </button>

              {showHistory && (
                <div style={{ marginTop: 8 }}>
                  {analysisHistory.length === 0 ? (
                    <div style={{ fontSize: 12, color: C.text3, padding: "8px", textAlign: "center" }}>No history yet</div>
                  ) : (
                    analysisHistory.map((entry) => (
                      <div key={entry.id} style={{ padding: "8px", marginBottom: 6, borderRadius: 6, background: C.borderLight, cursor: "pointer", fontSize: 11, transition: "all 0.2s" }}
                        onMouseEnter={e => e.currentTarget.style.background = C.border}
                        onMouseLeave={e => e.currentTarget.style.background = C.borderLight}>
                        <div style={{ fontWeight: 600, color: C.text, marginBottom: 2 }}>{entry.title}</div>
                        <div style={{ fontSize: 10, color: C.text3 }}>{entry.timestamp}</div>
                        <div style={{ fontSize: 10, color: C.text2, marginTop: 2 }}>📁 {entry.filename}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ fontSize: 11, color: C.text3, textAlign: "center", paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            v2.1 Enhanced
          </div>
        </div>
      )}

      {/* LEFT SIDE: CHAT & ANALYSIS */}
      <div className="ailab" style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: currentReport ? "60%" : "100%" }}>

        {/* Toggle Sidebar Button */}
        <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.navy }}>
            {sidebarOpen ? "◀" : "▶"}
          </button>
        </div>

        {/* Chat Area */}
        <div style={{ flex: 1, overflowY: "auto", paddingTop: 32, paddingBottom: 16 }} className="ailab-scrollbar">
          {messages.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: "12vh" }} className="ailab-fade-in">
              <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 6 }}>Actuarial AI Lab</div>
              <div style={{ fontSize: 15, color: C.text3, maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
                Upload data, get guided analysis with professional reports & next-step recommendations
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                style={{ display: "inline-flex", alignItems: "center", gap: 12, margin: "28px auto 0", padding: "16px 32px", borderRadius: 16,
                  border: `2px dashed ${C.border}`, background: C.white, cursor: "pointer", transition: "all 0.25s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.background = C.goldLight; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.white; }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.navy} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Upload CSV or Excel</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={e => uploadFile(e.target.files[0])} />

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 36, maxWidth: 700, margin: "36px auto 0" }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="ailab-suggestion"
                    onClick={() => { if (fileMeta) sendMessage(s.prompt, s); else fileInputRef.current?.click(); }}
                    style={{ padding: "10px 18px", borderRadius: 20, border: `1px solid ${C.border}`, background: C.white,
                      color: C.text, fontSize: 13, fontWeight: 500, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages with Enhanced Chart Grid Layout */}
          {messages.map((msg) => (
            <div key={msg.id} className="ailab-fade-in" style={{ marginBottom: 24, marginRight: 20 }}>
              {msg.type === "file_uploaded" && (
                <div style={{ background: C.white, borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                  <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, borderBottom: `1px solid ${C.borderLight}` }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: C.greenBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                      ✓
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{msg.meta.filename}</div>
                      <div style={{ fontSize: 12, color: C.text3 }}>{msg.meta.rows?.toLocaleString()} rows</div>
                    </div>
                  </div>
                </div>
              )}

              {msg.role === "user" && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginRight: 20 }}>
                  <div style={{ maxWidth: "75%", padding: "12px 18px", borderRadius: "18px 18px 4px 18px", background: C.navy, color: C.white, fontSize: 14 }}>
                    {msg.content}
                  </div>
                </div>
              )}

              {msg.role === "assistant" && (
                <div style={{ display: "flex", gap: 14 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${C.navy}, ${C.navyLight})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.white }}>AI</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, marginRight: 20 }}>
                    {msg.explanation && (
                      <div>
                        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.75, marginBottom: msg.hasCode ? 12 : 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {msg.explanation}
                        </div>
                        {/* COPY & REGENERATE BUTTONS */}
                        <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 12 }}>
                          <button onClick={() => copyToClipboard(msg.explanation)} style={{ padding: "6px 12px", borderRadius: 6, background: C.borderLight, border: "none", color: C.text2, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}
                            onMouseEnter={e => { e.currentTarget.style.background = C.border; e.currentTarget.style.color = C.text; }}
                            onMouseLeave={e => { e.currentTarget.style.background = C.borderLight; e.currentTarget.style.color = C.text2; }}>
                            📋 Copy
                          </button>
                          <button onClick={regenerateAnalysis} style={{ padding: "6px 12px", borderRadius: 6, background: C.borderLight, border: "none", color: C.text2, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}
                            onMouseEnter={e => { e.currentTarget.style.background = C.border; e.currentTarget.style.color = C.text; }}
                            onMouseLeave={e => { e.currentTarget.style.background = C.borderLight; e.currentTarget.style.color = C.text2; }}>
                            🔄 Regenerate
                          </button>
                        </div>
                      </div>
                    )}

                    {msg.execution && (
                      <div>
                        {/* ENHANCED: Charts Grid Layout (2x2) */}
                        {msg.execution.charts?.length > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: C.text2, marginBottom: 8 }}>
                              📊 Made {msg.execution.charts.length} charts
                            </div>
                            <div className="chart-grid">
                              {msg.execution.charts.map((chart, ci) => (
                                <div key={ci} style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden", aspectRatio: "4/3" }}>
                                  <img src={chart.data} alt={chart.filename} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {msg.execution.stdout && (
                          <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 12, marginTop: 12 }}>
                            <div style={{ padding: "14px 18px" }}>
                              {parseOutput(msg.execution.stdout).map((block, bi) => (
                                <div key={bi}>
                                  {block.type === "table" ? <OutputTable content={block.content} /> :
                                    <pre style={{ fontSize: 13, color: C.text2, margin: "4px 0", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{block.content}</pre>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: "flex", gap: 14, marginBottom: 24, marginRight: 20 }} className="ailab-fade-in">
              <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${C.navy}, ${C.navyLight})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.white }}>AI</span>
              </div>
              <div style={{ padding: "14px 0" }}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.text3, animation: "typingDot 1.2s infinite" }} />
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.text3, animation: "typingDot 1.2s infinite 0.2s" }} />
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.text3, animation: "typingDot 1.2s infinite 0.4s" }} />
                </div>
              </div>
              <style>{`@keyframes typingDot { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-4px); } }`}</style>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div style={{ padding: "12px 20px 24px", borderTop: `1px solid ${C.border}` }}>
          {fileMeta && (
            <div style={{ padding: "5px 14px", borderRadius: 20, background: C.white, border: `1px solid ${C.border}`, fontSize: 12, color: C.text2, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
              {fileMeta.filename}
              <span onClick={() => { setFile(null); setFileMeta(null); setPreview(null); }} style={{ marginLeft: 4, cursor: "pointer", color: C.text3 }}>×</span>
            </div>
          )}

          {fileMeta && messages.length <= 2 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {SUGGESTIONS.slice(0, 3).map((s, i) => (
                <button key={i} onClick={() => sendMessage(s.prompt, s)}
                  style={{ padding: "8px 16px", borderRadius: 20, border: `1px solid ${C.border}`, background: C.white,
                    color: C.text, fontSize: 12.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ position: "relative", background: C.white, borderRadius: 20, border: `1.5px solid ${C.border}` }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={fileMeta ? "Ask about your data..." : "Upload a file to start..."}
              rows={1}
              style={{ width: "100%", padding: "16px 100px 16px 20px", borderRadius: 20, border: "none", outline: "none",
                background: "transparent", color: C.text, fontSize: 14.5, fontFamily: "inherit", resize: "none",
                minHeight: 52, maxHeight: 140, lineHeight: 1.5 }}
            />
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ position: "absolute", right: 8, bottom: 8, width: 36, height: 36, borderRadius: 10, border: "none",
                background: input.trim() && !loading ? C.navy : C.borderLight, color: C.white, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {loading ? "..." : "→"}
            </button>
          </div>
        </div>

        {/* GUIDED SUGGESTIONS */}
        {currentAnalysisStep && currentAnalysisStep.nextSteps && (
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, background: C.bg }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text2, marginBottom: 8 }}>→ Next Steps</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                { text: "What is the main goal", icon: "🎯" },
                { text: "How would you apply insights", icon: "💡" },
                { text: "What else can you explore", icon: "🔍" }
              ].map((sug, i) => (
                <button key={i}
                  onClick={() => sendMessage(sug.text)}
                  style={{ padding: "8px 14px", borderRadius: 8, background: C.white, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 500, cursor: "pointer", color: C.text, transition: "all 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.gold}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                  {sug.icon} {sug.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT SIDE: PROFESSIONAL REPORT */}
      {currentReport && (
        <div style={{ width: "40%", background: C.white, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Report Header with Export Options */}
          <div style={{ padding: "20px", borderBottom: `1px solid ${C.border}`, background: C.white }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h3 style={{ margin: 0, color: C.navy, fontSize: 14, fontWeight: 600 }}>Report</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => saveAsWord(currentReport, currentAnalysisStep)}
                  style={{ padding: "6px 12px", borderRadius: 6, background: C.gold, border: "none", color: C.white, fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
                  onMouseLeave={e => e.currentTarget.style.opacity = 1}>
                  📄 Word
                </button>
                <button onClick={() => saveAsPDF(currentReport, currentAnalysisStep)}
                  style={{ padding: "6px 12px", borderRadius: 6, background: C.navy, border: "none", color: C.white, fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
                  onMouseLeave={e => e.currentTarget.style.opacity = 1}>
                  📕 PDF
                </button>
                <button onClick={saveToHistory}
                  style={{ padding: "6px 12px", borderRadius: 6, background: C.green, border: "none", color: C.white, fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
                  onMouseLeave={e => e.currentTarget.style.opacity = 1}>
                  📜 Save
                </button>
                <button onClick={showValidation}
                  style={{ padding: "6px 12px", borderRadius: 6, background: "#06b6d4", border: "none", color: C.white, fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
                  onMouseLeave={e => e.currentTarget.style.opacity = 1}>
                  ✓ Check
                </button>
              </div>
            </div>
          </div>

          {/* Report Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }} className="ailab-scrollbar">
            <h2 style={{ color: C.navy, fontSize: 18, marginTop: 0, marginBottom: 8 }}>{currentReport.title}</h2>

            <div style={{ fontSize: 13, color: C.text2, marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${C.borderLight}` }}>
              <p><strong>Purpose:</strong> {currentReport.purpose}</p>
              <p><strong>Generated:</strong> {currentReport.timestamp}</p>
            </div>

            <div>
              <h3 style={{ color: C.navy, fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Key Findings</h3>
              {currentReport.findings.map((finding, i) => (
                <div key={i} style={{ padding: "10px", background: C.bg, marginBottom: 8, borderRadius: 6, borderLeft: `4px solid ${C.gold}`, fontSize: 13, color: C.text }}>
                  <strong>{i + 1}.</strong> {finding}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, padding: 16, background: C.blueBg, borderRadius: 10, fontSize: 13, color: C.blue }}>
              <strong>✓ Ready to export</strong><br />
              <p>Click Word or PDF to download your professional report.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
