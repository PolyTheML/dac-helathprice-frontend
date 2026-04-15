/**
 * LifeInsurancePricer.jsx
 *
 * Internal actuarial workbench — Life Insurance Pricing (Mortality Ratio Method)
 * Exact JS port of: medical_reader/pricing/calculator.py + assumptions.py
 * Assumption version: v3.0-cambodia-2026-04-14
 *
 * Formula:
 *   Pure Premium = Face Amount × (q(x) / 1000) × Mortality Ratio
 *   Gross Premium = Pure Premium × (1 + Total Loading)
 *
 * When the underwriting API (api/main.py) is deployed, replace LOCAL_ONLY = true
 * and set UW_API_URL to the Render service URL.
 */

import { useState, useMemo } from "react";
import DriftMonitor from "./DriftMonitor";
import UnderwriterQueue from "./UnderwriterQueue";

// ─── Config ──────────────────────────────────────────────────────────────────
const LOCAL_ONLY = true; // flip to false once api/main.py is deployed on Render
const UW_API_URL = "https://dac-uw-api.onrender.com"; // placeholder — update when deployed

// ─── Brand colours (matches existing app) ────────────────────────────────────
const NAVY   = "#0d2b7a";
const NAVY_D = "#091d5e";
const GOLD   = "#f5a623";
const WHITE  = "#ffffff";
const LTGRAY = "#f8f9fb";
const TXT    = "#111827";
const TXT2   = "#4b5563";
const OK     = "#10b981";
const WARN   = "#f59e0b";
const ERR    = "#ef4444";
const TEAL   = "#0d9488";

// ─── Actuarial Assumptions (v3.0-cambodia-2026-04-14) ────────────────────────
// Mirrors: medical_reader/pricing/assumptions.py
const ASSUMPTION_VERSION = "v3.0-cambodia-2026-04-14";
const CAMBODIA_ADJ = 0.85; // observed A/E ≈ 85% of WHO SEA baseline

const MORTALITY_MALE = {
  "18-24": 0.80, "25-34": 1.10, "35-44": 2.20,
  "45-54": 4.80, "55-64": 10.50, "65+": 22.00,
};
const MORTALITY_FEMALE = {
  "18-24": 0.50, "25-34": 0.70, "35-44": 1.40,
  "45-54": 3.20, "55-64": 7.80,  "65+": 17.50,
};

// Risk factor multipliers (additive approach)
const RF = {
  smoking:           2.00,
  alcohol_heavy:     1.25,
  bmi_underweight:   1.20,
  bmi_overweight:    1.15,
  bmi_obese_1:       1.35,
  bmi_obese_2:       1.60,
  bp_elevated:       1.10,
  bp_stage1:         1.25,
  bp_stage2:         1.50,
  diabetes:          1.40,
  hypertension:      1.25,
  hyperlipidemia:    1.20,
  family_history_chd:1.30,
};

// Loading factors (% of pure premium)
const LOADING = {
  expense:     0.12, // 12% admin / underwriting / claims
  commission:  0.10, // 10% agent commission
  profit:      0.05, //  5% target ROE
  contingency: 0.05, //  5% catastrophe buffer
};

// Risk tier thresholds (mortality ratio cutoffs)
const TIERS = { low: 1.50, medium: 2.50, high: 4.00 };

// ─── Pure actuarial functions (mirror Python exactly) ─────────────────────────
function getAgeBand(age) {
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  if (age < 55) return "45-54";
  if (age < 65) return "55-64";
  return "65+";
}

function classifyBMI(bmi) {
  if (!bmi) return "normal";
  if (bmi < 18.5) return "underweight";
  if (bmi < 25.0) return "normal";
  if (bmi < 30.0) return "overweight";
  if (bmi < 35.0) return "obese1";
  return "obese2";
}

function classifyBP(sys, dia) {
  if (!sys || !dia) return "unknown";
  if (sys > 180 || dia > 120) return "crisis";
  if (sys >= 140 || dia >= 90)  return "stage2";
  if (sys >= 130 || dia >= 80)  return "stage1";
  if (sys >= 120 && dia < 80)   return "elevated";
  return "normal";
}

function getBaseMortality(age, gender) {
  const band  = getAgeBand(age);
  const table = gender === "F" ? MORTALITY_FEMALE : MORTALITY_MALE;
  return (table[band] ?? 4.80) * CAMBODIA_ADJ;
}

function calcMortalityRatio(inp) {
  let ratio = 1.0;
  const factors = [];

  if (inp.smoker) {
    ratio += RF.smoking - 1.0;
    factors.push({ label: "Smoking", multiplier: RF.smoking });
  }

  const bmiClass = classifyBMI(inp.bmi);
  if (bmiClass === "underweight") { ratio += RF.bmi_underweight - 1.0; factors.push({ label: "BMI — Underweight", multiplier: RF.bmi_underweight }); }
  else if (bmiClass === "overweight") { ratio += RF.bmi_overweight - 1.0; factors.push({ label: "BMI — Overweight",   multiplier: RF.bmi_overweight }); }
  else if (bmiClass === "obese1")  { ratio += RF.bmi_obese_1 - 1.0; factors.push({ label: "BMI — Obese I",       multiplier: RF.bmi_obese_1   }); }
  else if (bmiClass === "obese2")  { ratio += RF.bmi_obese_2 - 1.0; factors.push({ label: "BMI — Obese II",      multiplier: RF.bmi_obese_2   }); }

  const bpClass = classifyBP(inp.systolic, inp.diastolic);
  if (bpClass === "elevated") { ratio += RF.bp_elevated - 1.0; factors.push({ label: "BP — Elevated",  multiplier: RF.bp_elevated }); }
  else if (bpClass === "stage1")  { ratio += RF.bp_stage1  - 1.0; factors.push({ label: "BP — Stage 1",   multiplier: RF.bp_stage1  }); }
  else if (bpClass === "stage2")  { ratio += RF.bp_stage2  - 1.0; factors.push({ label: "BP — Stage 2",   multiplier: RF.bp_stage2  }); }
  else if (bpClass === "crisis")  { ratio += (RF.bp_stage2 - 1.0) + 0.10; factors.push({ label: "BP — Crisis",    multiplier: RF.bp_stage2 + 0.10 }); }
  else if (inp.hypertension && bpClass === "normal") {
    ratio += RF.hypertension - 1.0;
    factors.push({ label: "Hypertension (controlled)", multiplier: RF.hypertension });
  }

  if (inp.diabetes)            { ratio += RF.diabetes             - 1.0; factors.push({ label: "Diabetes",           multiplier: RF.diabetes            }); }
  if (inp.hyperlipidemia)      { ratio += RF.hyperlipidemia       - 1.0; factors.push({ label: "Hyperlipidemia",      multiplier: RF.hyperlipidemia      }); }
  if (inp.family_history_chd)  { ratio += RF.family_history_chd   - 1.0; factors.push({ label: "Family History — CHD",multiplier: RF.family_history_chd  }); }
  if (inp.alcohol === "Heavy") { ratio += RF.alcohol_heavy         - 1.0; factors.push({ label: "Alcohol (Heavy)",    multiplier: RF.alcohol_heavy       }); }

  ratio = Math.min(ratio, 5.0); // cap per calculator.py
  return { ratio, factors };
}

function classifyTier(mr) {
  if (mr <= TIERS.low)    return "LOW";
  if (mr <= TIERS.medium) return "MEDIUM";
  if (mr <= TIERS.high)   return "HIGH";
  return "DECLINE";
}

function calcPremium(inp) {
  const baseRate = getBaseMortality(inp.age, inp.gender);
  const { ratio, factors } = calcMortalityRatio(inp);
  const tier = classifyTier(ratio);

  const pure       = inp.faceAmount * (baseRate / 1000) * ratio;
  const expense    = pure * LOADING.expense;
  const commission = pure * LOADING.commission;
  const profit     = pure * LOADING.profit;
  const contingency= pure * LOADING.contingency;
  const totalLoad  = expense + commission + profit + contingency;
  const gross      = pure + totalLoad;

  const r = (n) => Math.round(n * 100) / 100;
  return {
    baseRate:      Math.round(baseRate * 10000) / 10000,
    mortalityRatio:Math.round(ratio    * 10000) / 10000,
    tier,
    factors,
    pure:          r(pure),
    expense:       r(expense),
    commission:    r(commission),
    profit:        r(profit),
    contingency:   r(contingency),
    totalLoad:     r(totalLoad),
    grossAnnual:   r(gross),
    grossMonthly:  r(gross / 12),
    version:       ASSUMPTION_VERSION,
  };
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function SectionHeader({ title, sub }) {
  return (
    <div style={{ background: `linear-gradient(135deg, ${NAVY}, #1a4fba)`, borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
      <div style={{ color: WHITE, fontWeight: 700, fontSize: 16 }}>{title}</div>
      {sub && <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: TXT2, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit",
  outline: "none", background: WHITE, color: TXT,
};

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10 }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? NAVY : "#d1d5db"}`,
          background: checked ? NAVY : WHITE, display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s", cursor: "pointer", flexShrink: 0,
        }}
      >
        {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={WHITE} strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
      </div>
      <span style={{ fontSize: 13, color: TXT, fontWeight: checked ? 600 : 400 }}>{label}</span>
    </label>
  );
}

function PremiumCard({ label, value, big, color }) {
  return (
    <div style={{ background: big ? NAVY : LTGRAY, borderRadius: 10, padding: "16px 20px", textAlign: "center", border: big ? "none" : "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: big ? "rgba(255,255,255,0.7)" : TXT2, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 700, color: big ? WHITE : (color || NAVY) }}>
        ${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}

function TierBadge({ tier }) {
  const cfg = {
    LOW:     { bg: "#d1fae5", color: OK,   label: "LOW RISK"    },
    MEDIUM:  { bg: "#fef3c7", color: WARN, label: "MEDIUM RISK" },
    HIGH:    { bg: "#fee2e2", color: ERR,  label: "HIGH RISK"   },
    DECLINE: { bg: "#f3f4f6", color: "#6b7280", label: "DECLINE" },
  };
  const c = cfg[tier] ?? cfg.DECLINE;
  return (
    <div style={{ background: c.bg, color: c.color, borderRadius: 8, padding: "10px 16px", textAlign: "center", fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>
      {c.label}
    </div>
  );
}

function BreakdownBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: TXT2 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: TXT }}>${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LifeInsurancePricer() {
  const [tab, setTab] = useState("pricer"); // "pricer" | "dashboard"

  const [inp, setInp] = useState({
    age: 35,
    gender: "M",
    faceAmount: 50000,
    termYears: 10,
    bmi: 23.5,
    smoker: false,
    alcohol: "None",
    diabetes: false,
    hypertension: false,
    hyperlipidemia: false,
    family_history_chd: false,
    systolic: 120,
    diastolic: 80,
  });

  const set = (k, v) => setInp(p => ({ ...p, [k]: v }));

  // Calculate live — no API call needed, exact same math as /pricing/what-if
  const result = useMemo(() => calcPremium(inp), [inp]);

  const tierColor = { LOW: OK, MEDIUM: WARN, HIGH: ERR, DECLINE: "#6b7280" }[result.tier] || NAVY;

  return (
    <div style={{ paddingTop: 80, minHeight: "100vh", background: LTGRAY, fontFamily: "'DM Sans', sans-serif" }}>

      {/* Page header */}
      <div style={{ background: `linear-gradient(135deg, ${NAVY_D} 0%, ${NAVY} 100%)`, padding: "48px 24px 40px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "inline-block", background: "rgba(245,166,35,0.15)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: 20, padding: "4px 14px", fontSize: 12, color: GOLD, fontWeight: 600, marginBottom: 12 }}>
            INTERNAL — ACTUARY WORKBENCH
          </div>
          <h1 style={{ color: WHITE, fontSize: 32, fontWeight: 700, margin: "0 0 8px" }}>Life Insurance Pricer</h1>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 15, margin: 0 }}>
            Mortality Ratio Method · Cambodia WHO SEA tables · Assumption {ASSUMPTION_VERSION}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", gap: 0 }}>
          {[["pricer", "Pricing Calculator"], ["dashboard", "Underwriter Dashboard"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "12px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: "none", background: "transparent",
                color: tab === key ? NAVY : TXT2,
                borderBottom: tab === key ? `2px solid ${NAVY}` : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Dashboard tab */}
      {tab === "dashboard" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
          <DriftMonitor backendUrl={UW_API_URL} />
          <UnderwriterQueue backendUrl={UW_API_URL} />
        </div>
      )}

      {/* Pricer tab */}
      {tab === "pricer" && <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>

        {/* ═══ LEFT — Inputs ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Policy Parameters */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <SectionHeader title="Policy Parameters" sub="Coverage amount and term" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Face Amount (USD)">
                <select value={inp.faceAmount} onChange={e => set("faceAmount", Number(e.target.value))} style={inputStyle}>
                  {[10000, 25000, 50000, 75000, 100000, 150000, 200000].map(v =>
                    <option key={v} value={v}>${v.toLocaleString()}</option>
                  )}
                </select>
              </Field>
              <Field label="Policy Term (years)">
                <select value={inp.termYears} onChange={e => set("termYears", Number(e.target.value))} style={inputStyle}>
                  {[5, 10, 15, 20, 25, 30].map(v => <option key={v} value={v}>{v} years</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* Applicant Profile */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <SectionHeader title="Applicant Profile" sub="Demographics" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Age">
                <input type="number" min={18} max={75} value={inp.age}
                  onChange={e => set("age", Number(e.target.value))} style={inputStyle} />
              </Field>
              <Field label="Gender">
                <select value={inp.gender} onChange={e => set("gender", e.target.value)} style={inputStyle}>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </Field>
              <Field label="BMI" hint="WHO: <18.5 under · 18.5–25 normal · 25–30 over · 30+ obese">
                <input type="number" min={10} max={60} step={0.1} value={inp.bmi}
                  onChange={e => set("bmi", Number(e.target.value))} style={inputStyle} />
              </Field>
              <Field label="Alcohol Use">
                <select value={inp.alcohol} onChange={e => set("alcohol", e.target.value)} style={inputStyle}>
                  <option>None</option>
                  <option>Moderate</option>
                  <option>Heavy</option>
                </select>
              </Field>
            </div>
          </div>

          {/* Health Flags */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <SectionHeader title="Health Flags" sub="Each flag applies an additive mortality multiplier" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
              <div>
                <Checkbox label="Smoker (+100% mortality)" checked={inp.smoker} onChange={v => set("smoker", v)} />
                <Checkbox label="Diabetes (+40%)"          checked={inp.diabetes} onChange={v => set("diabetes", v)} />
                <Checkbox label="Hypertension (+25%)"      checked={inp.hypertension} onChange={v => set("hypertension", v)} />
              </div>
              <div>
                <Checkbox label="Hyperlipidemia (+20%)"    checked={inp.hyperlipidemia} onChange={v => set("hyperlipidemia", v)} />
                <Checkbox label="Family Hx CHD (+30%)"     checked={inp.family_history_chd} onChange={v => set("family_history_chd", v)} />
              </div>
            </div>
          </div>

          {/* Blood Pressure */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <SectionHeader title="Blood Pressure" sub="JNC-8 classification · overrides hypertension flag if BP is elevated" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Systolic (mmHg)" hint="Normal <120">
                <input type="number" min={60} max={220} value={inp.systolic}
                  onChange={e => set("systolic", Number(e.target.value))} style={inputStyle} />
              </Field>
              <Field label="Diastolic (mmHg)" hint="Normal <80">
                <input type="number" min={40} max={140} value={inp.diastolic}
                  onChange={e => set("diastolic", Number(e.target.value))} style={inputStyle} />
              </Field>
            </div>
            {/* BP classification badge */}
            {(() => {
              const cls = classifyBP(inp.systolic, inp.diastolic);
              const bp = { normal: [OK, "Normal"], elevated: [WARN, "Elevated (+10%)"], stage1: [WARN, "Stage 1 (+25%)"], stage2: [ERR, "Stage 2 (+50%)"], crisis: [ERR, "Crisis — decline"], unknown: ["#9ca3af", "Unknown"] };
              const [c, l] = bp[cls] ?? ["#9ca3af", cls];
              return <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: c }}>BP Classification: {l}</div>;
            })()}
          </div>

        </div>

        {/* ═══ RIGHT — Results ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Premium Cards */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Live Premium</div>
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{ASSUMPTION_VERSION}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <PremiumCard label="Annual Premium" value={result.grossAnnual} big />
              <PremiumCard label="Monthly" value={result.grossMonthly} />
              <div style={{ background: LTGRAY, borderRadius: 10, padding: "16px 20px", textAlign: "center", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: TXT2, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Mortality Ratio</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: tierColor }}>{result.mortalityRatio.toFixed(2)}×</div>
              </div>
            </div>
            <TierBadge tier={result.tier} />
          </div>

          {/* Mortality Basis */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Mortality Basis</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                ["q(x) WHO SEA", `${(result.baseRate / CAMBODIA_ADJ).toFixed(2)}/1,000`],
                ["Cambodia ×0.85", `${result.baseRate.toFixed(4)}/1,000`],
                ["Age Band", getAgeBand(inp.age)],
              ].map(([k, v]) => (
                <div key={k} style={{ background: LTGRAY, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, color: TXT2, marginBottom: 4 }}>{k}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#eff6ff", borderRadius: 8, fontSize: 12, color: "#1d4ed8" }}>
              Pure Premium = ${inp.faceAmount.toLocaleString()} × {result.baseRate.toFixed(4)}/1,000 × {result.mortalityRatio.toFixed(2)} = <strong>${result.pure.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
          </div>

          {/* Premium Build-up */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Premium Build-up</div>
            <BreakdownBar label="Pure Premium (mortality cost)"    value={result.pure}        total={result.grossAnnual} color={TEAL}  />
            <BreakdownBar label="Expense Loading (12%)"           value={result.expense}     total={result.grossAnnual} color={GOLD}  />
            <BreakdownBar label="Commission Loading (10%)"        value={result.commission}  total={result.grossAnnual} color={GOLD}  />
            <BreakdownBar label="Profit Loading (5%)"             value={result.profit}      total={result.grossAnnual} color={WARN}  />
            <BreakdownBar label="Contingency Loading (5%)"        value={result.contingency} total={result.grossAnnual} color={WARN}  />
            <div style={{ borderTop: `2px solid ${NAVY}`, marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Gross Annual Premium</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>${result.grossAnnual.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          {/* Active Risk Factors */}
          <div style={{ background: WHITE, borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>
              Active Risk Factors
              <span style={{ fontSize: 12, fontWeight: 400, color: TXT2, marginLeft: 8 }}>
                (additive adjustment — Mortality Ratio = 1.00 {result.factors.map(f => `+ ${(f.multiplier - 1).toFixed(2)}`).join(" ")} = {result.mortalityRatio.toFixed(2)})
              </span>
            </div>
            {result.factors.length === 0 ? (
              <div style={{ padding: "16px", background: "#d1fae5", borderRadius: 8, fontSize: 13, color: OK, fontWeight: 600 }}>
                No risk factors — standard rate applies (Mortality Ratio = 1.00)
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
                    <th style={{ textAlign: "left",  padding: "8px 0",    color: TXT2, fontWeight: 600 }}>Risk Factor</th>
                    <th style={{ textAlign: "center",padding: "8px 8px",  color: TXT2, fontWeight: 600 }}>Multiplier</th>
                    <th style={{ textAlign: "right", padding: "8px 0",    color: TXT2, fontWeight: 600 }}>+Premium/yr</th>
                  </tr>
                </thead>
                <tbody>
                  {result.factors.map((f, i) => {
                    const marginalMR    = f.multiplier - 1.0;
                    const marginalPure  = inp.faceAmount * (result.baseRate / 1000) * marginalMR;
                    const marginalGross = marginalPure * (1 + LOADING.expense + LOADING.commission + LOADING.profit + LOADING.contingency);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 ? LTGRAY : WHITE }}>
                        <td style={{ padding: "10px 0",   color: TXT  }}>{f.label}</td>
                        <td style={{ padding: "10px 8px", color: ERR, fontWeight: 700, textAlign: "center" }}>{f.multiplier.toFixed(2)}×</td>
                        <td style={{ padding: "10px 0",   color: TXT, textAlign: "right" }}>
                          +${marginalGross.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* IRC Audit footer */}
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#92400e" }}>
            <strong>IRC Audit Trail</strong> · Assumption {ASSUMPTION_VERSION} · Cambodia mortality adjustment ×{CAMBODIA_ADJ} · Source: WHO SEA life tables 2020, adapted for Cambodia · Loadings: Expense 12% | Commission 10% | Profit 5% | Contingency 5%
          </div>

        </div>
      </div>}

      {/* Responsive style */}
      <style>{`
        @media (max-width: 768px) {
          div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
