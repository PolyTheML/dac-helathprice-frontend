import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar,
} from "recharts";
import { API_URL } from "./auth";

const NAVY = "#0d2b7a";
const NAVY_L = "#1a4fba";
const GOLD = "#f5a623";
const GOLD_D = "#e67e00";
const OK = "#10b981";
const WARN = "#f59e0b";
const DANGER = "#ef4444";
const TXT = "#111827";
const TXT2 = "#4b5563";
const LTGRAY = "#f1f3f5";

function InputRow({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: TXT2, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, children, badge }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 20px",
        borderRadius: 8,
        border: "none",
        background: active ? NAVY : "transparent",
        color: active ? "#fff" : TXT2,
        fontWeight: 600,
        fontSize: 14,
        cursor: "pointer",
        fontFamily: "inherit",
        position: "relative",
      }}
    >
      {children}
      {badge && (
        <span style={{
          position: "absolute", top: -6, right: -6,
          background: badge === "fail" ? DANGER : badge === "warning" ? WARN : OK,
          color: "#fff", fontSize: 10, fontWeight: 700,
          width: 18, height: 18, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {badge === "fail" ? "✕" : badge === "warning" ? "!" : "✓"}
        </span>
      )}
    </button>
  );
}

function Gauge({ value, label, threshold = 0.80 }) {
  const color = value >= threshold ? OK : value >= 0.65 ? WARN : DANGER;
  const pct = Math.min(100, Math.max(0, (value / 1.2) * 100));
  return (
    <div style={{ textAlign: "center", padding: 20, background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 12, color: TXT2, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>{label}</div>
      <div style={{ fontSize: 42, fontWeight: 700, color, marginBottom: 8 }}>{value.toFixed(3)}</div>
      <div style={{ width: "100%", height: 10, background: "#e5e7eb", borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.6s ease" }} />
      </div>
      <div style={{ fontSize: 12, color: value >= threshold ? OK : DANGER, fontWeight: 600 }}>
        {value >= threshold ? "Above threshold" : `Below ${threshold} threshold`}
      </div>
    </div>
  );
}

export default function AutoUnderwriting() {
  const [tab, setTab] = useState("quote");

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    vehicle_type: "sedan",
    year_of_manufacture: 2019,
    region: "phnom_penh",
    driver_age: 35,
    accident_history: false,
    coverage: "full",
    tier: "standard",
    family_size: 1,
  });
  const [loading, setLoading] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState("");

  // ── Live monitor state ─────────────────────────────────────────────────────
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null);
  const evtSourceRef = useRef(null);

  // ── Fairness state ─────────────────────────────────────────────────────────
  const [fairness, setFairness] = useState(null);
  const [fairnessLoading, setFairnessLoading] = useState(false);
  const [fairnessError, setFairnessError] = useState("");

  // ── Quote submission ───────────────────────────────────────────────────────
  const handleQuote = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/v1/auto/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPolicy(data);
      setCurrent({ premium: data.current_premium, deviation: data.deviation_multiplier });
      setHistory([
        {
          time: new Date().toLocaleTimeString(),
          premium: data.current_premium,
          deviation: data.deviation_multiplier,
        },
      ]);
      setTab("monitor");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── SSE helpers ────────────────────────────────────────────────────────────
  const connectStream = useCallback(() => {
    if (!policy?.policy_id) return;
    if (evtSourceRef.current) evtSourceRef.current.close();

    const url = `${API_URL}/api/v1/auto/policies/${policy.policy_id}/stream`;
    const es = new EventSource(url);
    evtSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.keepalive) return;
      setCurrent({ premium: data.new_premium, deviation: data.deviation });
      setHistory((prev) => {
        const next = [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            premium: data.new_premium,
            deviation: data.deviation,
          },
        ];
        if (next.length > 60) next.shift();
        return next;
      });
    };
  }, [policy]);

  const disconnectStream = useCallback(() => {
    if (evtSourceRef.current) {
      evtSourceRef.current.close();
      evtSourceRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    return () => {
      if (evtSourceRef.current) evtSourceRef.current.close();
    };
  }, []);

  // ── Fairness fetch ─────────────────────────────────────────────────────────
  const fetchFairness = useCallback(async () => {
    setFairnessLoading(true);
    setFairnessError("");
    try {
      const res = await fetch(`${API_URL}/api/v1/auto/fairness-audit`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFairness(await res.json());
    } catch (err) {
      setFairnessError(err.message);
    } finally {
      setFairnessLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "fairness") {
      fetchFairness();
      const id = setInterval(fetchFairness, 15000);
      return () => clearInterval(id);
    }
  }, [tab, fetchFairness]);

  // ── Visual helpers ─────────────────────────────────────────────────────────
  const gaugeColor = (d) => {
    if (!d || d < 1.05) return OK;
    if (d < 1.2) return WARN;
    return DANGER;
  };

  const gaugePct = (d) => {
    const clamped = Math.max(0.5, Math.min(2.0, d || 1.0));
    return ((clamped - 0.5) / 1.5) * 100;
  };

  const fairnessBadge = fairness
    ? fairness.status === "fail" ? "fail" : fairness.status === "warning" ? "warning" : "ok"
    : null;

  return (
    <div style={{ paddingTop: 96, paddingBottom: 48, maxWidth: 1200, margin: "0 auto", paddingLeft: 24, paddingRight: 24, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Auto Underwriting</h1>
        <p style={{ color: TXT2, fontSize: 15, lineHeight: 1.6 }}>
          Continuous underwriting dashboard — static GLM anchor + real-time telemetry deviation + fairness audit.
        </p>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, background: LTGRAY, padding: 6, borderRadius: 12, width: "fit-content" }}>
        <TabButton active={tab === "quote"} onClick={() => setTab("quote")}>Quote</TabButton>
        <TabButton active={tab === "monitor"} onClick={() => setTab("monitor")}>Live Monitor</TabButton>
        <TabButton active={tab === "fairness"} onClick={() => setTab("fairness")} badge={fairnessBadge}>Fairness Audit</TabButton>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
         TAB 1 — QUOTE
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === "quote" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
          {/* Left panel — Form */}
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #e5e7eb" }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: TXT }}>New Auto Quote</h2>
            <form onSubmit={handleQuote} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <InputRow label="Vehicle Type">
                <select
                  value={form.vehicle_type}
                  onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                >
                  {["motorcycle", "sedan", "suv", "truck"].map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </InputRow>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <InputRow label="Year of Mfr">
                  <input
                    type="number" min={1980} max={2025}
                    value={form.year_of_manufacture}
                    onChange={(e) => setForm({ ...form, year_of_manufacture: parseInt(e.target.value) })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                  />
                </InputRow>
                <InputRow label="Driver Age">
                  <input
                    type="number" min={18} max={75}
                    value={form.driver_age}
                    onChange={(e) => setForm({ ...form, driver_age: parseInt(e.target.value) })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                  />
                </InputRow>
              </div>

              <InputRow label="Region">
                <select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                >
                  {["phnom_penh", "siem_reap", "battambang", "sihanoukville", "kampong_cham", "rural_cambodia", "ho_chi_minh", "hanoi", "da_nang", "can_tho", "hai_phong"].map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                  ))}
                </select>
              </InputRow>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <InputRow label="Coverage">
                  <select
                    value={form.coverage}
                    onChange={(e) => setForm({ ...form, coverage: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                  >
                    <option value="ctpl_only">CTPL Only</option>
                    <option value="full">Full</option>
                  </select>
                </InputRow>
                <InputRow label="Tier">
                  <select
                    value={form.tier}
                    onChange={(e) => setForm({ ...form, tier: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                  >
                    {["basic", "standard", "premium", "full"].map((t) => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </InputRow>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <InputRow label="Prior Accident?">
                  <select
                    value={form.accident_history ? "yes" : "no"}
                    onChange={(e) => setForm({ ...form, accident_history: e.target.value === "yes" })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </InputRow>
                <InputRow label="Family Size">
                  <input
                    type="number" min={1} max={6}
                    value={form.family_size}
                    onChange={(e) => setForm({ ...form, family_size: parseInt(e.target.value) })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }}
                  />
                </InputRow>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%", padding: 12, borderRadius: 8, border: "none",
                  background: loading ? "#d1d5db" : GOLD, color: NAVY,
                  fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
                  marginTop: 4, fontFamily: "inherit",
                }}
              >
                {loading ? "Calculating…" : "Get GLM Quote"}
              </button>
            </form>

            {error && (
              <div style={{ marginTop: 14, padding: 12, background: "#fef2f2", borderRadius: 8, color: DANGER, fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>

          {/* Right panel — Quote result */}
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #e5e7eb" }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: TXT }}>Quote Result</h2>
            {policy ? (
              <div>
                <div style={{ marginBottom: 20, padding: 16, background: LTGRAY, borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: TXT2, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Policy ID</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 16, wordBreak: "break-all" }}>{policy.policy_id}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 12, color: TXT2 }}>GLM Anchor</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: TXT }}>{Math.round(policy.glm_anchor).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: TXT2 }}>Initial Premium</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: NAVY }}>{Math.round(policy.current_premium).toLocaleString()}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: TXT2, marginTop: 8 }}>VND</div>
                </div>
                <button
                  onClick={() => setTab("monitor")}
                  style={{
                    width: "100%", padding: 12, borderRadius: 8, border: "none",
                    background: NAVY, color: "#fff", fontWeight: 700, fontSize: 14,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Open Live Monitor →
                </button>
              </div>
            ) : (
              <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", background: LTGRAY, borderRadius: 12 }}>
                <div style={{ textAlign: "center", color: TXT2, fontSize: 14 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🚗</div>
                  Submit a quote to see results.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
         TAB 2 — LIVE MONITOR
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === "monitor" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
          {/* Left — Controls & metrics */}
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #e5e7eb" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: TXT }}>Stream Controls</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: connected ? OK : "#d1d5db",
                  boxShadow: connected ? `0 0 0 4px ${OK}30` : "none",
                  transition: "all 0.3s",
                }} />
                <span style={{ fontSize: 12, color: TXT2, fontWeight: 600 }}>
                  {connected ? "Live" : "Offline"}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <button
                onClick={connectStream}
                disabled={!policy || connected}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
                  background: !policy || connected ? "#d1d5db" : NAVY, color: "#fff",
                  fontWeight: 600, fontSize: 13, cursor: !policy || connected ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                Connect SSE
              </button>
              <button
                onClick={disconnectStream}
                disabled={!connected}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
                  background: connected ? DANGER : "#d1d5db", color: "#fff",
                  fontWeight: 600, fontSize: 13, cursor: connected ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                }}
              >
                Disconnect
              </button>
            </div>

            {current && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                <div style={{ textAlign: "center", padding: 16, background: LTGRAY, borderRadius: 12 }}>
                  <div style={{ fontSize: 11, color: TXT2, textTransform: "uppercase", letterSpacing: 1 }}>Current Premium</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginTop: 4 }}>
                    {Math.round(current.premium).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: TXT2 }}>VND</div>
                </div>
                <div style={{ textAlign: "center", padding: 16, background: LTGRAY, borderRadius: 12 }}>
                  <div style={{ fontSize: 11, color: TXT2, textTransform: "uppercase", letterSpacing: 1 }}>Deviation</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: gaugeColor(current.deviation), marginTop: 4 }}>
                    {current.deviation.toFixed(3)}×
                  </div>
                  <div style={{ width: "100%", height: 6, background: "#e5e7eb", borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
                    <div style={{
                      width: `${gaugePct(current.deviation)}%`, height: "100%",
                      background: gaugeColor(current.deviation),
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                </div>
              </div>
            )}

            {policy && (
              <div style={{ padding: 12, background: "#eff6ff", borderRadius: 8, fontSize: 12, color: "#1e40af" }}>
                <strong>Tip:</strong> Run <code style={{ background: "#dbeafe", padding: "2px 6px", borderRadius: 4 }}>python scripts/auto_telemetry_generator.py --policy-id {policy.policy_id}</code> to simulate the Phnom Penh Drift.
              </div>
            )}
          </div>

          {/* Right — Chart */}
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #e5e7eb" }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: TXT, marginBottom: 16 }}>Premium History</h2>
            {history.length > 0 ? (
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                    />
                    <Tooltip
                      formatter={(value) => [Math.round(value).toLocaleString() + " VND", "Premium"]}
                      labelStyle={{ fontSize: 12 }}
                    />
                    {policy && (
                      <ReferenceLine
                        y={policy.glm_anchor}
                        stroke={TXT2}
                        strokeDasharray="4 4"
                        label={{ value: "GLM Anchor", position: "insideTopRight", fontSize: 11, fill: TXT2 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="premium"
                      stroke={GOLD}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", background: LTGRAY, borderRadius: 12 }}>
                <div style={{ textAlign: "center", color: TXT2, fontSize: 14 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
                  {policy ? "Press 'Connect SSE' to start live monitoring." : "Create a quote to enable live monitoring."}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
         TAB 3 — FAIRNESS AUDIT
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === "fairness" && (
        <div>
          {fairnessLoading && !fairness && (
            <div style={{ textAlign: "center", padding: 60, color: TXT2 }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
              Loading fairness audit…
            </div>
          )}

          {fairnessError && (
            <div style={{ padding: 16, background: "#fef2f2", borderRadius: 8, color: DANGER, fontSize: 14, marginBottom: 24 }}>
              <strong>Fairness audit unavailable:</strong> {fairnessError}
              <div style={{ marginTop: 8 }}>
                <button onClick={fetchFairness} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: DANGER, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Retry
                </button>
              </div>
            </div>
          )}

          {fairness && (
            <>
              {/* Status banner */}
              <div style={{
                padding: "16px 20px", borderRadius: 12, marginBottom: 24,
                background: fairness.status === "pass" ? "#ecfdf5" : fairness.status === "warning" ? "#fffbeb" : "#fef2f2",
                border: `1px solid ${fairness.status === "pass" ? OK : fairness.status === "warning" ? WARN : DANGER}`,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: fairness.status === "pass" ? OK : fairness.status === "warning" ? WARN : DANGER,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 16, fontWeight: 700,
                }}>
                  {fairness.status === "pass" ? "✓" : fairness.status === "warning" ? "!" : "✕"}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: TXT }}>
                    Fairness Audit: {fairness.status.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 13, color: TXT2, marginTop: 2 }}>{fairness.message}</div>
                </div>
              </div>

              {/* Gauges */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
                <Gauge value={fairness.overall_dir} label="Overall DIR" />
                <Gauge value={fairness.age_dir} label="Age Group DIR" />
                <Gauge value={fairness.region_dir} label="Region DIR" />
              </div>

              {/* Group breakdown tables */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
                {/* Age groups */}
                <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #e5e7eb" }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Age Group Breakdown</h3>
                  {fairness.age_groups.length > 0 ? (
                    <div>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={fairness.age_groups} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="group_name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} domain={[0, "auto"]} />
                          <Tooltip formatter={(v) => [v.toFixed(4), "Mean Multiplier"]} />
                          <Bar dataKey="mean_multiplier" fill={NAVY_L} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                            <th style={{ textAlign: "left", padding: "8px 4px", color: TXT2, fontWeight: 600 }}>Group</th>
                            <th style={{ textAlign: "right", padding: "8px 4px", color: TXT2, fontWeight: 600 }}>Policies</th>
                            <th style={{ textAlign: "right", padding: "8px 4px", color: TXT2, fontWeight: 600 }}>Mean Mult.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fairness.age_groups.map((g) => (
                            <tr key={g.group_name} style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <td style={{ padding: "8px 4px" }}>{g.group_name}</td>
                              <td style={{ textAlign: "right", padding: "8px 4px" }}>{g.n_policies}</td>
                              <td style={{ textAlign: "right", padding: "8px 4px", fontWeight: 700 }}>{g.mean_multiplier.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ color: TXT2, fontSize: 14 }}>No age group data available.</p>
                  )}
                </div>

                {/* Region groups */}
                <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #e5e7eb" }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Region Breakdown</h3>
                  {fairness.region_groups.length > 0 ? (
                    <div>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={fairness.region_groups} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="group_name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} domain={[0, "auto"]} />
                          <Tooltip formatter={(v) => [v.toFixed(4), "Mean Multiplier"]} />
                          <Bar dataKey="mean_multiplier" fill={GOLD} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                            <th style={{ textAlign: "left", padding: "8px 4px", color: TXT2, fontWeight: 600 }}>Group</th>
                            <th style={{ textAlign: "right", padding: "8px 4px", color: TXT2, fontWeight: 600 }}>Policies</th>
                            <th style={{ textAlign: "right", padding: "8px 4px", color: TXT2, fontWeight: 600 }}>Mean Mult.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fairness.region_groups.map((g) => (
                            <tr key={g.group_name} style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <td style={{ padding: "8px 4px" }}>{g.group_name}</td>
                              <td style={{ textAlign: "right", padding: "8px 4px" }}>{g.n_policies}</td>
                              <td style={{ textAlign: "right", padding: "8px 4px", fontWeight: 700 }}>{g.mean_multiplier.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ color: TXT2, fontSize: 14 }}>No region data available.</p>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16, fontSize: 12, color: TXT2, textAlign: "center" }}>
                Refreshes every 15 seconds · Threshold = 0.80 per Prakas 093
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
