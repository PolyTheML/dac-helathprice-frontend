/**
 * Auto Pricing Lab v2 — Actuary Dashboard (Step 8)
 *
 * Three tabs:
 *   1. Quote Lab     — single profile → full GLM breakdown + ML badge
 *   2. Office Profiles — 8 representative personas, portfolio summary
 *   3. Coefficients  — COEFF_AUTO viewer with source citations
 *
 * Pricing runs locally (GLM engine re-implemented in JS).
 * If backend /api/v1/auto/price is available, ML adjustment is applied on top.
 */

import { useState, useCallback } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const NAVY   = "#0d2b7a";
const NAVY_D = "#091d5e";
const GOLD   = "#f5a623";
const WHITE  = "#ffffff";
const LTGRAY = "#f1f3f5";
const TXT    = "#111827";
const TXT2   = "#4b5563";
const OK     = "#10b981";
const WARN   = "#f59e0b";
const ERR    = "#ef4444";
const BORDER = "#e5e7eb";

const API_URL = "https://dac-healthprice-api.onrender.com";

// ─── COEFF_AUTO (mirrors src/shared/COEFF_AUTO.ts) ───────────────────────────
const BASE_RATES = {
  motorcycle: { frequency: 0.18, severity: 70_000_000 },
  sedan:      { frequency: 0.08, severity: 87_500_000 },
  suv:        { frequency: 0.07, severity: 105_000_000 },
  truck:      { frequency: 0.12, severity: 145_000_000 },
};

const VEHICLE_AGE_MULT = {
  motorcycle: { new: 0.85, young: 0.95, mid: 1.00, mature: 1.20, old: 1.45, vintage: 1.75 },
  sedan:      { new: 0.88, young: 0.95, mid: 1.00, mature: 1.18, old: 1.40, vintage: 1.65 },
  suv:        { new: 0.87, young: 0.94, mid: 1.00, mature: 1.16, old: 1.38, vintage: 1.60 },
  truck:      { new: 0.90, young: 0.96, mid: 1.00, mature: 1.22, old: 1.50, vintage: 1.85 },
};

const DRIVER_AGE_MULT = {
  under25: 1.35, age25to34: 1.00, age35to44: 0.95,
  age45to54: 1.05, age55to64: 1.15, over65: 1.30,
};

const REGION_MULT = {
  phnom_penh: 1.20, siem_reap: 1.05, battambang: 0.90,
  sihanoukville: 1.15, kampong_cham: 0.85, rural_cambodia: 0.70,
  ho_chi_minh: 1.25, hanoi: 1.20, da_nang: 1.00,
  can_tho: 0.88, hai_phong: 0.95,
};

const LOADING = { motorcycle: 0.32, sedan: 0.25, suv: 0.28, truck: 0.35 };
const TIER_MULT = { basic: 0.70, standard: 1.00, premium: 1.40, full: 2.00 };
const DEDUCTIBLE = { basic: 5_000_000, standard: 2_000_000, premium: 1_000_000, full: 0 };
const COVERAGE_MULT = { ctpl_only: 0.60, full: 1.00 };

function vehicleAgeBracket(yom, refYear = 2024) {
  const age = refYear - yom;
  if (age <= 2)  return "new";
  if (age <= 5)  return "young";
  if (age <= 10) return "mid";
  if (age <= 15) return "mature";
  if (age <= 20) return "old";
  return "vintage";
}

function driverAgeBracket(age) {
  if (age < 25) return "under25";
  if (age < 35) return "age25to34";
  if (age < 45) return "age35to44";
  if (age < 55) return "age45to54";
  if (age < 65) return "age55to64";
  return "over65";
}

function computeGLM(profile) {
  const { vehicleType, yearOfManufacture, region, driverAge, accidentHistory, coverage, tier } = profile;
  const base = BASE_RATES[vehicleType];
  const vaBracket  = vehicleAgeBracket(yearOfManufacture);
  const drvBracket = driverAgeBracket(+driverAge);

  const mVehicleAge     = VEHICLE_AGE_MULT[vehicleType][vaBracket];
  const mDriverAge      = DRIVER_AGE_MULT[drvBracket];
  const mRegion         = REGION_MULT[region];
  const mAccident       = accidentHistory ? 1.45 : 0.85;
  const mCoverage       = COVERAGE_MULT[coverage];
  const combinedMult    = mVehicleAge * mDriverAge * mRegion * mAccident * mCoverage;

  const basePure        = base.frequency * base.severity;
  const riskAdjusted    = basePure * combinedMult;
  const load            = LOADING[vehicleType];
  const loaded          = riskAdjusted * (1 + load);
  const tierMult        = TIER_MULT[tier];
  const tiered          = loaded * tierMult;
  const dedCredit       = DEDUCTIBLE[tier];
  const glmPrice        = Math.max(tiered - dedCredit, 500_000);

  return {
    baseFrequency: base.frequency,
    baseSeverity: base.severity,
    basePure,
    multipliers: { vehicleAge: mVehicleAge, driverAge: mDriverAge, region: mRegion, accident: mAccident, coverage: mCoverage, combined: combinedMult },
    riskAdjusted,
    loadingFactor: load,
    loaded,
    tierMult,
    tiered,
    dedCredit,
    glmPrice,
    vaBracket,
    drvBracket,
  };
}

// ─── Office personas (MODEL_AUTO_OFFICE) ─────────────────────────────────────
const OFFICE_PROFILES = [
  { id: "P1", label: "PP Motorcycle",  vehicleType: "motorcycle", yearOfManufacture: 2020, region: "phnom_penh",    driverAge: 28, accidentHistory: false, coverage: "full",      tier: "standard" },
  { id: "P2", label: "Siem Reap Sedan",vehicleType: "sedan",      yearOfManufacture: 2018, region: "siem_reap",     driverAge: 42, accidentHistory: false, coverage: "full",      tier: "silver"   },
  { id: "P3", label: "HCM Sedan (Acc)",vehicleType: "sedan",      yearOfManufacture: 2017, region: "ho_chi_minh",   driverAge: 35, accidentHistory: true,  coverage: "full",      tier: "standard" },
  { id: "P4", label: "Hanoi SUV",      vehicleType: "suv",        yearOfManufacture: 2022, region: "hanoi",         driverAge: 45, accidentHistory: false, coverage: "full",      tier: "premium"  },
  { id: "P5", label: "Rural Truck",    vehicleType: "truck",      yearOfManufacture: 2015, region: "rural_cambodia",driverAge: 38, accidentHistory: false, coverage: "ctpl_only", tier: "basic"    },
  { id: "P6", label: "Da Nang SUV",    vehicleType: "suv",        yearOfManufacture: 2021, region: "da_nang",       driverAge: 50, accidentHistory: false, coverage: "full",      tier: "standard" },
  { id: "P7", label: "Battambang Bike",vehicleType: "motorcycle", yearOfManufacture: 2012, region: "battambang",    driverAge: 22, accidentHistory: true,  coverage: "ctpl_only", tier: "basic"    },
  { id: "P8", label: "HCMC Truck",     vehicleType: "truck",      yearOfManufacture: 2019, region: "ho_chi_minh",   driverAge: 55, accidentHistory: false, coverage: "full",      tier: "premium"  },
];
// Fix tier names to valid keys
OFFICE_PROFILES.forEach(p => {
  if (p.tier === "silver") p.tier = "standard";
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const REGION_LABELS = {
  phnom_penh: "Phnom Penh", siem_reap: "Siem Reap", battambang: "Battambang",
  sihanoukville: "Sihanoukville", kampong_cham: "Kampong Cham", rural_cambodia: "Rural Cambodia",
  ho_chi_minh: "Ho Chi Minh City", hanoi: "Hanoi", da_nang: "Da Nang",
  can_tho: "Can Tho", hai_phong: "Hai Phong",
};
const VEHICLE_LABELS = { motorcycle: "Motorcycle", sedan: "Sedan", suv: "SUV / Crossover", truck: "Truck / Van" };
const COVERAGE_LABELS = { ctpl_only: "CTPL Only", full: "Full Coverage" };
const TIER_LABELS = { basic: "Basic", standard: "Standard", premium: "Premium", full: "Full Protection" };

const fmtVND = n => "₫" + Math.round(n).toLocaleString();
const fmtPct = n => (n * 100).toFixed(1) + "%";
const fmtX   = n => n.toFixed(3) + "×";

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = NAVY }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "16px 20px", minWidth: 0 }}>
      <div style={{ fontSize: 11, color: TXT2, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: TXT2, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MultRow({ label, value, isTotal = false }) {
  const isAbove = value > 1;
  const isBelow = value < 1;
  const bg = isTotal ? "#f0f4ff" : "transparent";
  return (
    <tr style={{ background: bg, borderTop: isTotal ? `1px solid ${BORDER}` : "none" }}>
      <td style={{ padding: "7px 12px", fontSize: 13, color: TXT, fontWeight: isTotal ? 600 : 400 }}>{label}</td>
      <td style={{ padding: "7px 12px", textAlign: "right" }}>
        <span style={{
          fontSize: 13, fontWeight: isTotal ? 700 : 500,
          color: isTotal ? NAVY : isAbove ? ERR : isBelow ? OK : TXT2,
          background: isTotal ? "transparent" : isAbove ? "#fef2f2" : isBelow ? "#f0fdf4" : "transparent",
          padding: "2px 8px", borderRadius: 4,
        }}>{fmtX(value)}</span>
      </td>
    </tr>
  );
}

function ModelBadge({ source, accuracy, ml_adjustment }) {
  const isML = source === "ml";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      background: isML ? NAVY : "#374151",
      borderRadius: 8, padding: "8px 14px",
    }}>
      <span style={{ fontSize: 18 }}>{isML ? "🤖" : "📐"}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>
          {isML ? `ML Model · Accuracy: ${accuracy}%` : "GLM Only · ML not yet trained"}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
          {isML
            ? `Adjustment: ${ml_adjustment >= 0 ? "+" : ""}${(ml_adjustment * 100).toFixed(1)}%`
            : "Run python -m app.ml.train_model to enable ML layer"}
        </div>
      </div>
    </div>
  );
}

// ─── Tab 1: Quote Lab ─────────────────────────────────────────────────────────
function QuoteLab() {
  const [form, setForm] = useState({
    vehicleType: "sedan", yearOfManufacture: 2019, region: "phnom_penh",
    driverAge: 35, accidentHistory: false, coverage: "full", tier: "standard",
  });
  const [result, setResult] = useState(null);
  const [apiResult, setApiResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const runQuote = useCallback(async () => {
    setLoading(true);
    setApiResult(null);
    const glm = computeGLM(form);
    setResult(glm);

    // Try backend for ML adjustment
    try {
      const res = await fetch(`${API_URL}/api/v1/auto/price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_type: form.vehicleType,
          year_of_manufacture: +form.yearOfManufacture,
          region: form.region,
          driver_age: +form.driverAge,
          accident_history: form.accidentHistory,
          coverage: form.coverage,
          tier: form.tier,
          family_size: 1,
          reference_year: 2024,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        setApiResult(data);
      }
    } catch (_) { /* backend not running — local GLM only */ }
    setLoading(false);
  }, [form]);

  const finalPrice = apiResult ? apiResult.final_price : result?.glmPrice;
  const margin = apiResult
    ? apiResult.margin
    : result ? (result.glmPrice - result.riskAdjusted) / result.glmPrice : 0;

  const inputStyle = {
    width: "100%", padding: "9px 12px", borderRadius: 8,
    border: `1.5px solid ${BORDER}`, fontSize: 14,
    fontFamily: "inherit", outline: "none", background: WHITE, color: TXT,
    boxSizing: "border-box",
  };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: TXT2, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 24 }}>
      {/* Left: form */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 20 }}>Vehicle Profile</div>
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={labelStyle}>Vehicle Type</label>
            <select style={inputStyle} value={form.vehicleType} onChange={e => set("vehicleType", e.target.value)}>
              {Object.entries(VEHICLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Year of Manufacture</label>
            <input type="number" style={inputStyle} value={form.yearOfManufacture}
              min={1980} max={2025} onChange={e => set("yearOfManufacture", +e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Region</label>
            <select style={inputStyle} value={form.region} onChange={e => set("region", e.target.value)}>
              <optgroup label="Cambodia">
                {["phnom_penh","siem_reap","battambang","sihanoukville","kampong_cham","rural_cambodia"].map(r =>
                  <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
              </optgroup>
              <optgroup label="Vietnam">
                {["ho_chi_minh","hanoi","da_nang","can_tho","hai_phong"].map(r =>
                  <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Driver Age</label>
            <input type="number" style={inputStyle} value={form.driverAge}
              min={18} max={75} onChange={e => set("driverAge", +e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Coverage Type</label>
            <select style={inputStyle} value={form.coverage} onChange={e => set("coverage", e.target.value)}>
              {Object.entries(COVERAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tier</label>
            <select style={inputStyle} value={form.tier} onChange={e => set("tier", e.target.value)}>
              {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Prior Accident?</label>
            <div style={{ display: "flex", gap: 12 }}>
              {[["No", false], ["Yes", true]].map(([lbl, val]) => (
                <button key={lbl} onClick={() => set("accidentHistory", val)}
                  style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: `1.5px solid ${form.accidentHistory === val ? NAVY : BORDER}`,
                    background: form.accidentHistory === val ? NAVY : WHITE,
                    color: form.accidentHistory === val ? WHITE : TXT2,
                    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <button onClick={runQuote} disabled={loading}
            style={{ width: "100%", padding: 12, borderRadius: 10, background: loading ? "#9ca3af" : GOLD,
              color: NAVY, border: "none", fontSize: 15, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", marginTop: 4 }}>
            {loading ? "Computing…" : "Calculate Premium"}
          </button>
        </div>
      </div>

      {/* Right: results */}
      <div>
        {!result && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%",
            background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, minHeight: 300 }}>
            <div style={{ textAlign: "center", color: TXT2 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Fill in the profile and calculate</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Full GLM breakdown will appear here</div>
            </div>
          </div>
        )}

        {result && (
          <div style={{ display: "grid", gap: 16 }}>
            {/* Price summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <StatCard label="GLM Price" value={fmtVND(result.glmPrice)} sub="Before ML adjustment" />
              <StatCard label="Final Premium" value={fmtVND(finalPrice)} sub={apiResult ? "GLM + ML adjusted" : "GLM only"} color={GOLD} />
              <StatCard label="Margin" value={fmtPct(margin)} sub="Above expected claims" color={margin > 0.15 ? OK : WARN} />
            </div>

            {/* Model badge */}
            <div>
              <ModelBadge
                source={apiResult?.model_source ?? "glm_only"}
                accuracy={apiResult?.model_accuracy_pct ?? 75}
                ml_adjustment={apiResult?.ml_adjustment ?? 0}
              />
            </div>

            {/* GLM Breakdown */}
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ background: NAVY, padding: "12px 20px", color: WHITE, fontSize: 14, fontWeight: 700 }}>
                GLM Pricing Breakdown
              </div>
              <div style={{ padding: 0 }}>
                {/* Base rates */}
                <div style={{ padding: "12px 20px", background: "#fafbff", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: TXT2, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Base Rates</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div><span style={{ fontSize: 11, color: TXT2 }}>Frequency</span><br />
                      <span style={{ fontSize: 14, fontWeight: 600, color: TXT }}>{result.baseFrequency}/yr</span></div>
                    <div><span style={{ fontSize: 11, color: TXT2 }}>Severity</span><br />
                      <span style={{ fontSize: 14, fontWeight: 600, color: TXT }}>{fmtVND(result.baseSeverity)}</span></div>
                    <div><span style={{ fontSize: 11, color: TXT2 }}>Base Pure Premium</span><br />
                      <span style={{ fontSize: 14, fontWeight: 600, color: TXT }}>{fmtVND(result.basePure)}</span></div>
                  </div>
                </div>

                {/* Multipliers */}
                <div style={{ padding: "0 0 12px" }}>
                  <div style={{ padding: "12px 20px 4px", fontSize: 11, fontWeight: 700, color: TXT2, textTransform: "uppercase", letterSpacing: 1 }}>Risk Multipliers</div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <MultRow label={`Vehicle Age (${result.vaBracket})`} value={result.multipliers.vehicleAge} />
                      <MultRow label={`Driver Age (${result.drvBracket})`}  value={result.multipliers.driverAge} />
                      <MultRow label={`Region (${REGION_LABELS[form.region]})`} value={result.multipliers.region} />
                      <MultRow label={`Accident History (${form.accidentHistory ? "Yes" : "No"})`} value={result.multipliers.accident} />
                      <MultRow label={`Coverage (${COVERAGE_LABELS[form.coverage]})`} value={result.multipliers.coverage} />
                      <MultRow label="Combined Multiplier" value={result.multipliers.combined} isTotal />
                    </tbody>
                  </table>
                </div>

                {/* Price build-up */}
                <div style={{ padding: "12px 20px", borderTop: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: TXT2, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Price Build-up</div>
                  {[
                    ["Risk-Adjusted Pure Premium", fmtVND(result.riskAdjusted), TXT],
                    [`Loading (+${fmtPct(result.loadingFactor)})`, fmtVND(result.loaded - result.riskAdjusted), WARN],
                    ["Loaded Premium", fmtVND(result.loaded), TXT],
                    [`Tier (${TIER_LABELS[form.tier]} × ${fmtX(result.tierMult)})`, fmtVND(result.tiered), TXT],
                    [`Deductible Credit`, `−${fmtVND(result.dedCredit)}`, OK],
                  ].map(([lbl, val, col]) => (
                    <div key={lbl} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 13 }}>
                      <span style={{ color: TXT2 }}>{lbl}</span>
                      <span style={{ fontWeight: 600, color: col }}>{val}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontSize: 15, fontWeight: 700 }}>
                    <span style={{ color: NAVY }}>GLM Final Price</span>
                    <span style={{ color: NAVY }}>{fmtVND(result.glmPrice)}</span>
                  </div>
                  {apiResult && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                        <span style={{ color: TXT2 }}>ML Adjustment ({apiResult.ml_adjustment >= 0 ? "+" : ""}{(apiResult.ml_adjustment * 100).toFixed(1)}%)</span>
                        <span style={{ fontWeight: 600, color: apiResult.ml_adjustment < 0 ? OK : ERR }}>{fmtVND(apiResult.ml_adjustment_vnd)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontSize: 16, fontWeight: 700, borderTop: `2px solid ${GOLD}` }}>
                        <span style={{ color: NAVY }}>Final Price (ML)</span>
                        <span style={{ color: GOLD }}>{fmtVND(apiResult.final_price)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: Office Profiles ───────────────────────────────────────────────────
function OfficeProfiles() {
  const results = OFFICE_PROFILES.map(p => ({
    ...p,
    glm: computeGLM(p),
  }));

  const totalPremium = results.reduce((s, r) => s + r.glm.glmPrice, 0);
  const avgMargin    = results.reduce((s, r) => s + (r.glm.glmPrice - r.glm.riskAdjusted) / r.glm.glmPrice, 0) / results.length;
  const avgPremium   = totalPremium / results.length;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <StatCard label="Portfolio Premium" value={fmtVND(totalPremium)} sub="8 profiles combined" />
        <StatCard label="Avg Premium / Policy" value={fmtVND(avgPremium)} sub="All tiers & types" color={GOLD} />
        <StatCard label="Avg GLM Margin" value={fmtPct(avgMargin)} sub="Across all profiles" color={OK} />
      </div>

      {/* Table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ background: NAVY, padding: "12px 20px", color: WHITE, fontSize: 14, fontWeight: 700 }}>
          MODEL_AUTO_OFFICE — Representative Personas
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: LTGRAY }}>
                {["#","Profile","Type","YOM","Region","Age","Acc.","Coverage","Tier","Base Pure","Combined ×","Loaded","GLM Price","Margin"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: h === "#" || h === "Acc." ? "center" : "left",
                    fontWeight: 700, color: TXT2, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
                    borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const margin = (r.glm.glmPrice - r.glm.riskAdjusted) / r.glm.glmPrice;
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? WHITE : "#fafbff" }}>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: TXT2, fontSize: 12 }}>{r.id}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: NAVY, whiteSpace: "nowrap" }}>{r.label}</td>
                    <td style={{ padding: "10px 12px", color: TXT }}>{VEHICLE_LABELS[r.vehicleType]}</td>
                    <td style={{ padding: "10px 12px", color: TXT }}>{r.yearOfManufacture}</td>
                    <td style={{ padding: "10px 12px", color: TXT, whiteSpace: "nowrap" }}>{REGION_LABELS[r.region]}</td>
                    <td style={{ padding: "10px 12px", color: TXT }}>{r.driverAge}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>{r.accidentHistory ? "✓" : "—"}</td>
                    <td style={{ padding: "10px 12px", color: TXT }}>{COVERAGE_LABELS[r.coverage]}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ background: "#f0f4ff", color: NAVY, padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                        {TIER_LABELS[r.tier]}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: TXT, whiteSpace: "nowrap" }}>{fmtVND(r.glm.basePure)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <span style={{ color: r.glm.multipliers.combined > 1.2 ? ERR : r.glm.multipliers.combined < 0.9 ? OK : TXT2, fontWeight: 600 }}>
                        {fmtX(r.glm.multipliers.combined)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: TXT, whiteSpace: "nowrap" }}>{fmtVND(r.glm.loaded)}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: NAVY, whiteSpace: "nowrap" }}>{fmtVND(r.glm.glmPrice)}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ color: margin > 0.20 ? OK : margin > 0.10 ? WARN : ERR, fontWeight: 600 }}>
                        {fmtPct(margin)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* By vehicle type breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {["motorcycle","sedan","suv","truck"].map(vt => {
          const group = results.filter(r => r.vehicleType === vt);
          if (!group.length) return null;
          const avg = group.reduce((s, r) => s + r.glm.glmPrice, 0) / group.length;
          return (
            <div key={vt} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, color: TXT2, textTransform: "uppercase", letterSpacing: 1 }}>Avg — {VEHICLE_LABELS[vt]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 4 }}>{fmtVND(avg)}</div>
              <div style={{ fontSize: 12, color: TXT2, marginTop: 2 }}>{group.length} profile{group.length > 1 ? "s" : ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab 3: Coefficients ──────────────────────────────────────────────────────
function CoefficientsViewer() {
  const sections = [
    {
      title: "Base Rates (Frequency × Severity)",
      source: "Vietnam Insurance Registry 2024 Table 3.1; ABeam SE Asia Motor 2023 p.47-49",
      cols: ["Vehicle Type", "Frequency (claims/yr)", "Severity (VND/claim)", "Base Pure Premium"],
      rows: Object.entries(BASE_RATES).map(([vt, r]) => [
        VEHICLE_LABELS[vt], r.frequency + "/yr", fmtVND(r.severity), fmtVND(r.frequency * r.severity),
      ]),
    },
    {
      title: "Loading Factors",
      source: "ABeam SE Asia 2023; Vietnam Insurance Registry 2024",
      cols: ["Vehicle Type", "Loading Factor", "Interpretation"],
      rows: Object.entries(LOADING).map(([vt, l]) => [
        VEHICLE_LABELS[vt], fmtPct(l), `Insurer retains ${fmtPct(l)} above expected claims`,
      ]),
    },
    {
      title: "Tier Multipliers",
      source: "DirectAsia VN, Bao Viet, PTI tariffs 2024; ABeam 2023 appendix",
      cols: ["Tier", "Multiplier", "Deductible Credit"],
      rows: Object.entries(TIER_MULT).map(([t, m]) => [
        TIER_LABELS[t], fmtX(m), `−${fmtVND(DEDUCTIBLE[t])}`,
      ]),
    },
    {
      title: "Region Multipliers",
      source: "Vietnam Insurance Registry 2024 Table 6.1; Statista Cambodia 2024; ABeam 2023",
      cols: ["Region", "Multiplier", "vs Baseline"],
      rows: Object.entries(REGION_MULT).map(([r, m]) => [
        REGION_LABELS[r], fmtX(m),
        m > 1 ? `+${fmtPct(m - 1)} above Da Nang baseline` : m < 1 ? `${fmtPct(m - 1)} below baseline` : "Baseline",
      ]),
    },
    {
      title: "Driver Age Multipliers",
      source: "ABeam SE Asia 2023 Table 5.4; Statista Cambodia 2024",
      cols: ["Age Bracket", "Multiplier"],
      rows: [
        ["18–24 (under25)", fmtX(DRIVER_AGE_MULT.under25)],
        ["25–34 (age25to34)", fmtX(DRIVER_AGE_MULT.age25to34)],
        ["35–44 (age35to44)", fmtX(DRIVER_AGE_MULT.age35to44)],
        ["45–54 (age45to54)", fmtX(DRIVER_AGE_MULT.age45to54)],
        ["55–64 (age55to64)", fmtX(DRIVER_AGE_MULT.age55to64)],
        ["65+ (over65)",      fmtX(DRIVER_AGE_MULT.over65)],
      ],
    },
    {
      title: "Accident History Multipliers",
      source: "ABeam SE Asia 2023 Table 5.6; DirectAsia Vietnam tariffs 2024",
      cols: ["History", "Multiplier"],
      rows: [
        ["No prior claim (good-driver discount)", fmtX(0.85)],
        ["Prior claim (loading applied)", fmtX(1.45)],
      ],
    },
  ];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ background: "#fffbeb", border: `1px solid ${GOLD}`, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#92400e" }}>
        <strong>Read-only view.</strong> Coefficient editing requires actuary approval (governance layer — Step 11).
        All values are source-attributed for thesis documentation.
      </div>
      {sections.map(sec => (
        <div key={sec.title} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ background: NAVY, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: WHITE, fontSize: 14, fontWeight: 700 }}>{sec.title}</span>
          </div>
          <div style={{ padding: "8px 20px", background: "#fafbff", borderBottom: `1px solid ${BORDER}`, fontSize: 12, color: TXT2 }}>
            📚 Source: {sec.source}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: LTGRAY }}>
                {sec.cols.map(c => (
                  <th key={c} style={{ padding: "9px 16px", textAlign: "left", fontWeight: 700, color: TXT2,
                    fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
                    borderBottom: `1px solid ${BORDER}` }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sec.rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? WHITE : "#fafbff" }}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ padding: "9px 16px", color: j === 0 ? TXT : j === 1 ? NAVY : TXT2, fontWeight: j === 1 ? 700 : 400 }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AutoPricingLab() {
  const [tab, setTab] = useState("quote");

  const tabs = [
    { id: "quote",    label: "Quote Lab",        icon: "🧮" },
    { id: "profiles", label: "Office Profiles",   icon: "👥" },
    { id: "coeffs",   label: "Coefficients",      icon: "📋" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: LTGRAY, fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${NAVY_D} 0%, ${NAVY} 100%)`, padding: "32px 32px 0" }}>
        <div style={{ maxWidth: 1300, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 28 }}>🚗</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: WHITE }}>
                Auto Pricing Lab <span style={{ color: GOLD }}>v2</span>
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
                GLM + ML Hybrid · Cambodia & Vietnam · Actuarial Coefficient Engine
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginTop: 24 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: "10px 22px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 14, fontWeight: 600, transition: "all 0.15s",
                  background: tab === t.id ? WHITE : "rgba(255,255,255,0.08)",
                  color: tab === t.id ? NAVY : "rgba(255,255,255,0.7)" }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 32px 48px" }}>
        {tab === "quote"    && <QuoteLab />}
        {tab === "profiles" && <OfficeProfiles />}
        {tab === "coeffs"   && <CoefficientsViewer />}
      </div>
    </div>
  );
}
