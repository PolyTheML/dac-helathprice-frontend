/**
 * ActuarialWorkbench.jsx
 *
 * Health GLM Pricing Workbench — Attribution, Sensitivity, Assumptions Editor
 * Client-side port of: C:\DAC\dac-health\backend\app\main.py  (COEFF + _glm_predict)
 * Model version: v2.3  |  Poisson-Gamma GLM
 *
 * Tabs:
 *   Attribution  — SHAP-style waterfall: log-space contribution per factor
 *   Sensitivity  — vary one factor across all levels, compare premiums
 *   Assumptions  — edit COEFF multipliers in-session; premium recalculates live
 */

import { useState, useMemo } from "react";

// ── Brand colours (matches app) ───────────────────────────────────────────────
const NAVY   = "#0d2b7a";
const NAVY_D = "#091d5e";
const GOLD   = "#f5a623";
const WHITE  = "#ffffff";
const LTGRAY = "#f8f9fb";
const TXT    = "#111827";
const TXT2   = "#4b5563";
const OK     = "#10b981";
const ERR    = "#ef4444";
const WARN   = "#f59e0b";
const TEAL   = "#0d9488";

// ── Default COEFF — mirrors main.py exactly ───────────────────────────────────
const DEFAULT_COEFF = {
  version: "v2.3",
  base_freq:          { ipd: 0.12, opd: 2.5, dental: 0.80, maternity: 0.15 },
  base_sev:           { ipd: 2500, opd: 60,  dental: 120,  maternity: 3500  },
  age_factors:        { "18-24": 0.85, "25-34": 1.00, "35-44": 1.12, "45-54": 1.28, "55-64": 1.48, "65+": 1.72 },
  smoking_factors:    { Never: 1.00, Former: 1.15, Current: 1.40 },
  exercise_factors:   { Sedentary: 1.20, Light: 1.05, Moderate: 0.90, Active: 0.80 },
  occupation_factors: { "Office/Desk": 0.85, "Retail/Service": 1.00, Healthcare: 1.05, "Manual Labor": 1.15, "Industrial/High-Risk": 1.30, Retired: 1.10 },
  region_factors:     { "Phnom Penh": 1.20, "Siem Reap": 1.05, Battambang: 0.90, Sihanoukville: 1.10, "Kampong Cham": 0.85, "Rural Areas": 0.75 },
  tier_factors:       { Bronze: 0.70, Silver: 1.00, Gold: 1.45, Platinum: 2.10 },
  preexist_per_condition: 0.20,
  sev_age_gradient:   0.006,
  load_factor:        0.30,
};

// ── Pure actuarial functions ──────────────────────────────────────────────────
function getAgeBand(age) {
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  if (age < 55) return "45-54";
  if (age < 65) return "55-64";
  return "65+";
}

function calcGLM(profile, coeff) {
  const cov = profile.coverage || "ipd";
  const ab  = getAgeBand(profile.age);

  const af   = coeff.age_factors[ab]                          ?? 1.0;
  const sf   = coeff.smoking_factors[profile.smoking]         ?? 1.0;
  const ef   = coeff.exercise_factors[profile.exercise]       ?? 1.0;
  const of_  = coeff.occupation_factors[profile.occupation]   ?? 1.0;
  const rf   = coeff.region_factors[profile.region]           ?? 1.0;
  const pf   = 1 + (profile.n_preexist ?? 0) * coeff.preexist_per_condition;
  const tf   = coeff.tier_factors[profile.tier]               ?? 1.0;

  const freq    = coeff.base_freq[cov] * af * sf * ef * of_ * pf;
  const sev     = coeff.base_sev[cov] * rf * (1 + Math.max(0, profile.age - 30) * coeff.sev_age_gradient);
  const expected = freq * sev;
  const premium  = expected * tf * (1 + coeff.load_factor);

  return {
    premium:  Math.round(premium),
    expected: Math.round(expected),
    freq:     parseFloat(freq.toFixed(4)),
    sev:      Math.round(sev),
    factors:  { af, sf, ef, of: of_, rf, pf, tf },
    ab,
  };
}

function buildAttribution(profile, coeff) {
  const cov  = profile.coverage || "ipd";
  const ab   = getAgeBand(profile.age);
  const r    = calcGLM(profile, coeff);
  const { factors } = r;

  // Base premium = base_freq × base_sev × tier × (1 + load) — no risk adjustments
  const basePremium = coeff.base_freq[cov] * coeff.base_sev[cov]
    * (coeff.tier_factors[profile.tier] ?? 1.0)
    * (1 + coeff.load_factor);

  const items = [
    { label: `Age (${ab})`,                        factor: factors.af,  type: "freq" },
    { label: `Smoking (${profile.smoking})`,        factor: factors.sf,  type: "freq" },
    { label: `Exercise (${profile.exercise})`,      factor: factors.ef,  type: "freq" },
    { label: `Occupation (${profile.occupation})`,  factor: factors.of,  type: "freq" },
    { label: `Pre-existing (×${profile.n_preexist})`, factor: factors.pf, type: "freq" },
    { label: `Region (${profile.region})`,          factor: factors.rf,  type: "sev"  },
  ];

  const totalLogMult = items.reduce((s, it) => s + Math.log(it.factor), 0);

  return {
    basePremium: Math.round(basePremium),
    finalPremium: r.premium,
    items: items.map(it => ({
      ...it,
      logContrib:    Math.log(it.factor),
      pctContrib:    totalLogMult !== 0 ? (Math.log(it.factor) / Math.abs(totalLogMult)) * 100 : 0,
      premiumDelta:  Math.round(r.premium * (it.factor - 1) / (items.reduce((p, x) => p * x.factor, 1))),
    })).sort((a, b) => Math.abs(b.logContrib) - Math.abs(a.logContrib)),
  };
}

const SENSITIVITY_LEVELS = {
  age:        [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70],
  smoking:    ["Never", "Former", "Current"],
  exercise:   ["Sedentary", "Light", "Moderate", "Active"],
  occupation: Object.keys(DEFAULT_COEFF.occupation_factors),
  region:     Object.keys(DEFAULT_COEFF.region_factors),
  tier:       ["Bronze", "Silver", "Gold", "Platinum"],
  n_preexist: [0, 1, 2, 3, 4, 5],
};

function computeSensitivity(profile, coeff, factor) {
  const levels = SENSITIVITY_LEVELS[factor] ?? [];
  return levels.map(level => ({
    level:   String(level),
    premium: calcGLM({ ...profile, [factor]: level }, coeff).premium,
    current: level === profile[factor] || String(level) === String(profile[factor]),
  }));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ── Sub-components ────────────────────────────────────────────────────────────
const inputStyle = {
  width: "100%", padding: "8px 12px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", fontSize: 13, fontFamily: "inherit",
  outline: "none", background: WHITE, color: TXT,
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: TXT2, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>{children}</div>;
}

function PremiumBadge({ label, value, accent }) {
  return (
    <div style={{ background: accent ? NAVY : LTGRAY, borderRadius: 10, padding: "14px 18px", textAlign: "center" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: accent ? "rgba(255,255,255,0.65)" : TXT2, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: accent ? 26 : 20, fontWeight: 700, color: accent ? WHITE : NAVY }}>
        ${value.toLocaleString()}
      </div>
    </div>
  );
}

// Attribution waterfall bar
function WaterfallBar({ label, factor, logContrib, pctContrib }) {
  const positive = logContrib >= 0;
  const barWidth = Math.min(Math.abs(pctContrib), 100);
  const color    = positive ? ERR : OK;
  const bg       = positive ? "#fef2f2" : "#ecfdf5";

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: TXT, fontWeight: 500, minWidth: 200 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: TXT2 }}>×{factor.toFixed(3)}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color, background: bg, borderRadius: 4, padding: "1px 6px", minWidth: 50, textAlign: "right" }}>
            {positive ? "+" : ""}{pctContrib.toFixed(1)}%
          </span>
        </div>
      </div>
      <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${barWidth}%`,
          background: color,
          borderRadius: 4,
          float: positive ? "right" : "left",
          transition: "width 0.35s ease",
        }} />
      </div>
    </div>
  );
}

// Sensitivity comparison bar
function SensBar({ label, premium, maxPremium, isCurrent }) {
  const pct = maxPremium > 0 ? (premium / maxPremium) * 100 : 0;
  return (
    <div style={{
      marginBottom: 8, padding: "8px 12px", borderRadius: 8,
      background: isCurrent ? "#eff6ff" : LTGRAY,
      border: isCurrent ? `1.5px solid #bfdbfe` : "1.5px solid transparent",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: TXT, fontWeight: isCurrent ? 600 : 400 }}>
          {isCurrent && <span style={{ color: NAVY, marginRight: 4 }}>▶</span>}
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>${premium.toLocaleString()}</span>
      </div>
      <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: isCurrent ? NAVY : TEAL, borderRadius: 3, transition: "width 0.35s ease" }} />
      </div>
    </div>
  );
}

// Inline number input for assumptions editor
function AssumptionInput({ value, onChange }) {
  return (
    <input
      type="number"
      step="0.01"
      min="0.1"
      max="5"
      value={value}
      onChange={e => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v > 0) onChange(v);
      }}
      style={{
        width: 72, padding: "4px 8px", borderRadius: 6,
        border: "1.5px solid #d1d5db", fontSize: 12,
        fontFamily: "monospace", outline: "none", textAlign: "right",
      }}
    />
  );
}

// ── Profile input panel (shared across Attribution + Sensitivity tabs) ────────
function ProfilePanel({ profile, setP }) {
  const sel = v => ({ ...inputStyle, fontSize: 13 });
  return (
    <Card>
      <SectionTitle>Applicant Profile</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <Field label="Age">
          <input type="number" min={18} max={75} value={profile.age}
            onChange={e => setP("age", Number(e.target.value))} style={inputStyle} />
        </Field>
        <Field label="Coverage">
          <select value={profile.coverage} onChange={e => setP("coverage", e.target.value)} style={sel()}>
            <option value="ipd">IPD Hospital</option>
            <option value="opd">OPD Rider</option>
            <option value="dental">Dental</option>
            <option value="maternity">Maternity</option>
          </select>
        </Field>
        <Field label="Smoking Status">
          <select value={profile.smoking} onChange={e => setP("smoking", e.target.value)} style={sel()}>
            {["Never", "Former", "Current"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Tier">
          <select value={profile.tier} onChange={e => setP("tier", e.target.value)} style={sel()}>
            {["Bronze", "Silver", "Gold", "Platinum"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Exercise">
          <select value={profile.exercise} onChange={e => setP("exercise", e.target.value)} style={sel()}>
            {["Sedentary", "Light", "Moderate", "Active"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Occupation">
          <select value={profile.occupation} onChange={e => setP("occupation", e.target.value)} style={sel()}>
            {Object.keys(DEFAULT_COEFF.occupation_factors).map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Region">
          <select value={profile.region} onChange={e => setP("region", e.target.value)} style={sel()}>
            {Object.keys(DEFAULT_COEFF.region_factors).map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Pre-existing Conditions">
          <select value={profile.n_preexist} onChange={e => setP("n_preexist", Number(e.target.value))} style={sel()}>
            {[0, 1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v === 0 ? "None" : `${v} condition${v > 1 ? "s" : ""}`}</option>)}
          </select>
        </Field>
      </div>
    </Card>
  );
}

// ── Tab: Attribution ──────────────────────────────────────────────────────────
function AttributionTab({ profile, setP, coeff }) {
  const attr = useMemo(() => buildAttribution(profile, coeff), [profile, coeff]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
      <ProfilePanel profile={profile} setP={setP} />

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Premium summary */}
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <PremiumBadge label="Base Premium" value={attr.basePremium} />
            <PremiumBadge label="Annual Premium" value={attr.finalPremium} accent />
            <div style={{ background: LTGRAY, borderRadius: 10, padding: "14px 18px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: TXT2, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Risk Loading
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: attr.finalPremium > attr.basePremium ? ERR : OK }}>
                {attr.finalPremium > attr.basePremium ? "+" : ""}{Math.round((attr.finalPremium / attr.basePremium - 1) * 100)}%
              </div>
            </div>
          </div>
        </Card>

        {/* Waterfall */}
        <Card>
          <SectionTitle>Factor Attribution (log-space contribution)</SectionTitle>
          <div style={{ fontSize: 11, color: TXT2, marginBottom: 16, padding: "8px 12px", background: "#eff6ff", borderRadius: 6, border: "1px solid #dbeafe" }}>
            Each bar shows a factor's % contribution to total log-risk deviation from base. Red = surcharge, green = discount.
          </div>

          {/* Neutral line indicator */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: OK, fontWeight: 600 }}>← DISCOUNT</span>
            <span style={{ fontSize: 10, color: ERR, fontWeight: 600 }}>SURCHARGE →</span>
          </div>

          {attr.items.map((it, i) => (
            <WaterfallBar
              key={i}
              label={it.label}
              factor={it.factor}
              logContrib={it.logContrib}
              pctContrib={it.pctContrib}
            />
          ))}

          <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 12, fontSize: 11, color: TXT2, fontFamily: "monospace" }}>
            Base ${attr.basePremium.toLocaleString()} → adjustments → Final ${attr.finalPremium.toLocaleString()}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Tab: Sensitivity ──────────────────────────────────────────────────────────
const FACTOR_LABELS = {
  age:        "Age",
  smoking:    "Smoking Status",
  exercise:   "Exercise Frequency",
  occupation: "Occupation Type",
  region:     "Region",
  tier:       "Coverage Tier",
  n_preexist: "Pre-existing Conditions",
};

function SensitivityTab({ profile, setP, coeff }) {
  const [factor, setFactor] = useState("smoking");

  const data     = useMemo(() => computeSensitivity(profile, coeff, factor), [profile, coeff, factor]);
  const maxPrem  = data.reduce((m, d) => Math.max(m, d.premium), 0);
  const current  = calcGLM(profile, coeff);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ProfilePanel profile={profile} setP={setP} />

        {/* Factor selector */}
        <Card>
          <Field label="Vary this factor">
            <select value={factor} onChange={e => setFactor(e.target.value)} style={inputStyle}>
              {Object.entries(FACTOR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div style={{ fontSize: 12, color: TXT2, marginTop: 4 }}>
            All other inputs are held at the values you set on the left. The highlighted bar (▶) is your current selection.
          </div>
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Current premium */}
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <PremiumBadge label="Current Annual Premium" value={current.premium} accent />
            <PremiumBadge label="Monthly" value={Math.round(current.premium / 12)} />
          </div>
        </Card>

        {/* Sensitivity chart */}
        <Card>
          <SectionTitle>Premium by {FACTOR_LABELS[factor]}</SectionTitle>
          <div style={{ fontSize: 11, color: TXT2, marginBottom: 16, padding: "8px 12px", background: "#f0fdf4", borderRadius: 6, border: "1px solid #bbf7d0" }}>
            Min: <strong>${Math.min(...data.map(d => d.premium)).toLocaleString()}</strong> &nbsp;|&nbsp;
            Max: <strong>${maxPrem.toLocaleString()}</strong> &nbsp;|&nbsp;
            Range: <strong>${(maxPrem - Math.min(...data.map(d => d.premium))).toLocaleString()}</strong>
          </div>
          {data.map((d, i) => (
            <SensBar
              key={i}
              label={d.level}
              premium={d.premium}
              maxPremium={maxPrem}
              isCurrent={d.current}
            />
          ))}
        </Card>
      </div>
    </div>
  );
}

// ── Tab: Assumptions Editor ───────────────────────────────────────────────────
function AssumptionsTab({ profile, coeff, setCoeff, isDirty, resetCoeff }) {
  const current = useMemo(() => calcGLM(profile, coeff), [profile, coeff]);
  const baseline = useMemo(() => calcGLM(profile, DEFAULT_COEFF), [profile]);

  const setFactor = (group, key, val) => {
    setCoeff(prev => ({
      ...prev,
      [group]: { ...prev[group], [key]: val },
    }));
  };

  const setScalar = (key, val) => {
    setCoeff(prev => ({ ...prev, [key]: val }));
  };

  const GROUPS = [
    { key: "age_factors",        label: "Age Factors",        hint: "Frequency multiplier per age band" },
    { key: "smoking_factors",    label: "Smoking Factors",    hint: "Frequency multiplier" },
    { key: "exercise_factors",   label: "Exercise Factors",   hint: "Frequency multiplier" },
    { key: "occupation_factors", label: "Occupation Factors", hint: "Frequency multiplier" },
    { key: "region_factors",     label: "Region Factors",     hint: "Severity multiplier (healthcare cost)" },
    { key: "tier_factors",       label: "Tier Factors",       hint: "Applied to expected annual cost" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 24, alignItems: "start" }}>

      {/* Left: live premium impact */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Card>
          <SectionTitle>Live Impact (Current Profile)</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <PremiumBadge label="Baseline (v2.3)" value={baseline.premium} />
            <PremiumBadge label="With Edits" value={current.premium} accent />
          </div>
          <div style={{
            padding: "12px 14px", borderRadius: 8, marginBottom: 12,
            background: current.premium > baseline.premium ? "#fef2f2" : "#ecfdf5",
            border: `1px solid ${current.premium > baseline.premium ? "#fecaca" : "#a7f3d0"}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: current.premium > baseline.premium ? ERR : OK }}>
              {current.premium > baseline.premium ? "▲" : "▼"} ${Math.abs(current.premium - baseline.premium).toLocaleString()} (
              {((current.premium / baseline.premium - 1) * 100).toFixed(1)}%) vs baseline
            </div>
          </div>
          {isDirty && (
            <button
              onClick={resetCoeff}
              style={{
                width: "100%", padding: "9px", borderRadius: 8, border: `1.5px solid ${NAVY}`,
                background: WHITE, color: NAVY, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Reset to v2.3 defaults
            </button>
          )}
          {!isDirty && (
            <div style={{ fontSize: 11, color: TXT2, textAlign: "center", padding: "8px 0" }}>No changes from v2.3 defaults</div>
          )}
        </Card>

        {/* Scalars */}
        <Card>
          <SectionTitle>Scalar Assumptions</SectionTitle>
          {[
            { key: "preexist_per_condition", label: "Pre-existing (per condition)", hint: "Additive frequency load per condition" },
            { key: "sev_age_gradient",       label: "Severity age gradient",        hint: "Per year above age 30" },
            { key: "load_factor",            label: "Expense & profit loading",      hint: "Applied to expected cost" },
          ].map(({ key, label, hint }) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: TXT2, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>{hint}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number" step="0.005" min="0" max="2"
                  value={coeff[key]}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0) setScalar(key, v);
                  }}
                  style={{ width: 80, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #d1d5db", fontSize: 13, fontFamily: "monospace", outline: "none", textAlign: "right" }}
                />
                {coeff[key] !== DEFAULT_COEFF[key] && (
                  <span style={{ fontSize: 10, color: WARN }}>was {DEFAULT_COEFF[key]}</span>
                )}
              </div>
            </div>
          ))}
        </Card>

        {/* Base freq/sev */}
        <Card>
          <SectionTitle>Base Frequency & Severity</SectionTitle>
          {["ipd", "opd", "dental", "maternity"].map(cov => (
            <div key={cov} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 6, textTransform: "uppercase" }}>{cov}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: TXT2, marginBottom: 3 }}>Base Freq</div>
                  <input type="number" step="0.01" min="0" value={coeff.base_freq[cov]}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) setCoeff(prev => ({ ...prev, base_freq: { ...prev.base_freq, [cov]: v } }));
                    }}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid #d1d5db", fontSize: 12, fontFamily: "monospace", outline: "none" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: TXT2, marginBottom: 3 }}>Base Severity ($)</div>
                  <input type="number" step="10" min="0" value={coeff.base_sev[cov]}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) setCoeff(prev => ({ ...prev, base_sev: { ...prev.base_sev, [cov]: v } }));
                    }}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid #d1d5db", fontSize: 12, fontFamily: "monospace", outline: "none" }}
                  />
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Right: factor tables */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {GROUPS.map(({ key, label, hint }) => (
          <Card key={key}>
            <SectionTitle>{label}</SectionTitle>
            <div style={{ fontSize: 11, color: TXT2, marginBottom: 12 }}>{hint}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
                  <th style={{ textAlign: "left", padding: "6px 0", color: TXT2, fontWeight: 600 }}>Level</th>
                  <th style={{ textAlign: "center", padding: "6px 8px", color: TXT2, fontWeight: 600 }}>Multiplier</th>
                  <th style={{ textAlign: "center", padding: "6px 8px", color: TXT2, fontWeight: 600 }}>vs Default</th>
                  <th style={{ textAlign: "center", padding: "6px 0", color: TXT2, fontWeight: 600 }}>Direction</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(coeff[key]).map(([lvl, val], i) => {
                  const def    = DEFAULT_COEFF[key][lvl];
                  const changed = val !== def;
                  const dir    = val > 1 ? "▲ surcharge" : val < 1 ? "▼ discount" : "— neutral";
                  const dirCol = val > 1 ? ERR : val < 1 ? OK : TXT2;
                  return (
                    <tr key={lvl} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 ? LTGRAY : WHITE }}>
                      <td style={{ padding: "8px 0", color: TXT }}>{lvl}</td>
                      <td style={{ padding: "8px 8px", textAlign: "center" }}>
                        <AssumptionInput
                          value={val}
                          onChange={v => setFactor(key, lvl, v)}
                        />
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontSize: 11, color: changed ? WARN : TXT2, fontFamily: "monospace" }}>
                        {changed ? `was ${def}` : "—"}
                      </td>
                      <td style={{ padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 600, color: dirCol }}>
                        {dir}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ActuarialWorkbench() {
  const [tab, setTab] = useState("attribution");

  const [profile, setProfile] = useState({
    age: 35,
    smoking:    "Never",
    exercise:   "Moderate",
    occupation: "Office/Desk",
    region:     "Phnom Penh",
    n_preexist: 0,
    coverage:   "ipd",
    tier:       "Silver",
  });

  const [coeff, setCoeff]     = useState(() => deepClone(DEFAULT_COEFF));
  const [isDirty, setIsDirty] = useState(false);

  const setP = (k, v) => setProfile(p => ({ ...p, [k]: v }));

  const handleSetCoeff = (fn) => {
    setCoeff(fn);
    setIsDirty(true);
  };

  const resetCoeff = () => {
    setCoeff(deepClone(DEFAULT_COEFF));
    setIsDirty(false);
  };

  const TABS = [
    ["attribution", "Attribution"],
    ["sensitivity",  "Sensitivity"],
    ["assumptions",  "Assumptions Editor"],
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "inline-block", background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: 20, padding: "3px 12px", fontSize: 11, color: GOLD, fontWeight: 600, marginBottom: 8 }}>
              HEALTH GLM — WORKBENCH
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: NAVY, margin: 0 }}>Actuarial Pricing Workbench</h2>
            <p style={{ color: TXT2, fontSize: 13, marginTop: 4 }}>
              Poisson-Gamma GLM v2.3 · {Object.keys(DEFAULT_COEFF.age_factors).length} age bands · {Object.keys(DEFAULT_COEFF.region_factors).length} regions
            </p>
          </div>
          {isDirty && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#92400e", fontWeight: 600 }}>
              Unsaved edits — assumptions differ from v2.3
            </div>
          )}
        </div>
      </div>

      {/* Sub-tab bar */}
      <div style={{ background: WHITE, borderRadius: 10, border: "1px solid #e5e7eb", padding: "4px", display: "inline-flex", gap: 4, marginBottom: 24 }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "none", borderRadius: 8,
              background: tab === key ? NAVY : "transparent",
              color: tab === key ? WHITE : TXT2,
              transition: "all 0.2s", fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "attribution" && <AttributionTab profile={profile} setP={setP} coeff={coeff} />}
      {tab === "sensitivity"  && <SensitivityTab profile={profile} setP={setP} coeff={coeff} />}
      {tab === "assumptions"  && (
        <AssumptionsTab
          profile={profile}
          coeff={coeff}
          setCoeff={handleSetCoeff}
          isDirty={isDirty}
          resetCoeff={resetCoeff}
        />
      )}

      {/* Audit footer */}
      <div style={{ marginTop: 32, padding: "12px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 11, color: "#92400e" }}>
        <strong>Workbench Note:</strong> Assumptions edits are session-only and do not affect the production model at dac-healthprice-api.onrender.com. To promote revised assumptions to production, update COEFF in <code>main.py</code> and redeploy.
      </div>

      <style>{`
        @media (max-width: 900px) {
          div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          div[style*="grid-template-columns: 380px 1fr"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
