/**
 * Auto Pricing Lab v2 — Actuary Dashboard (Step 8)
 *
 * Tabs:
 *   1. Quote Lab        — single profile → full GLM breakdown + ML badge
 *   2. Office Profiles  — 8 representative personas, portfolio summary
 *   3. Coefficients     — editable COEFF_AUTO with live preview & save to draft
 *
 * Coefficient state is lifted to AutoPricingLab so edits instantly
 * propagate to Quote Lab and Office Profiles.
 */

import { useState, useCallback, useMemo } from "react";

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
const PURPLE = "#7c3aed";

const API_URL = "https://dac-healthprice-api.onrender.com";
const LS_KEY  = "auto_lab_coeff_draft";

// ─── Default coefficients (source of truth) ───────────────────────────────────
const DEFAULTS = {
  base: {
    motorcycle: { frequency: 0.18, severity: 70_000_000 },
    sedan:      { frequency: 0.08, severity: 87_500_000 },
    suv:        { frequency: 0.07, severity: 105_000_000 },
    truck:      { frequency: 0.12, severity: 145_000_000 },
  },
  vehicleAgeMult: {
    motorcycle: { new: 0.85, young: 0.95, mid: 1.00, mature: 1.20, old: 1.45, vintage: 1.75 },
    sedan:      { new: 0.88, young: 0.95, mid: 1.00, mature: 1.18, old: 1.40, vintage: 1.65 },
    suv:        { new: 0.87, young: 0.94, mid: 1.00, mature: 1.16, old: 1.38, vintage: 1.60 },
    truck:      { new: 0.90, young: 0.96, mid: 1.00, mature: 1.22, old: 1.50, vintage: 1.85 },
  },
  driverAgeMult: {
    under25: 1.35, age25to34: 1.00, age35to44: 0.95,
    age45to54: 1.05, age55to64: 1.15, over65: 1.30,
  },
  regionMult: {
    phnom_penh: 1.20, siem_reap: 1.05, battambang: 0.90,
    sihanoukville: 1.15, kampong_cham: 0.85, rural_cambodia: 0.70,
    ho_chi_minh: 1.25, hanoi: 1.20, da_nang: 1.00,
    can_tho: 0.88, hai_phong: 0.95,
  },
  loading:   { motorcycle: 0.32, sedan: 0.25, suv: 0.28, truck: 0.35 },
  tierMult:  { basic: 0.70, standard: 1.00, premium: 1.40, full: 2.00 },
  deductible:{ basic: 5_000_000, standard: 2_000_000, premium: 1_000_000, full: 0 },
  accident:  { no: 0.85, yes: 1.45 },
};

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function loadInitialCoeffs() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return JSON.parse(saved).coeffs;
  } catch (_) {}
  return deepClone(DEFAULTS);
}

// ─── GLM engine (accepts live coefficients) ───────────────────────────────────
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

function computeGLM(profile, C) {
  const { vehicleType, yearOfManufacture, region, driverAge, accidentHistory, coverage, tier } = profile;
  const base = C.base[vehicleType];
  const vaBracket  = vehicleAgeBracket(yearOfManufacture);
  const drvBracket = driverAgeBracket(+driverAge);

  const mVehicleAge  = C.vehicleAgeMult[vehicleType][vaBracket];
  const mDriverAge   = C.driverAgeMult[drvBracket];
  const mRegion      = C.regionMult[region];
  const mAccident    = accidentHistory ? C.accident.yes : C.accident.no;
  const mCoverage    = coverage === "ctpl_only" ? 0.60 : 1.00;
  const combined     = mVehicleAge * mDriverAge * mRegion * mAccident * mCoverage;

  const basePure     = base.frequency * base.severity;
  const riskAdjusted = basePure * combined;
  const load         = C.loading[vehicleType];
  const loaded       = riskAdjusted * (1 + load);
  const tierMult     = C.tierMult[tier];
  const tiered       = loaded * tierMult;
  const dedCredit    = C.deductible[tier];
  const glmPrice     = Math.max(tiered - dedCredit, 500_000);

  return { baseFrequency: base.frequency, baseSeverity: base.severity, basePure,
    multipliers: { vehicleAge: mVehicleAge, driverAge: mDriverAge, region: mRegion, accident: mAccident, coverage: mCoverage, combined },
    riskAdjusted, loadingFactor: load, loaded, tierMult, tiered, dedCredit, glmPrice, vaBracket, drvBracket };
}

// ─── Office personas ──────────────────────────────────────────────────────────
const OFFICE_PROFILES = [
  { id:"P1", label:"PP Motorcycle",   vehicleType:"motorcycle", yearOfManufacture:2020, region:"phnom_penh",     driverAge:28, accidentHistory:false, coverage:"full",      tier:"standard" },
  { id:"P2", label:"Siem Reap Sedan", vehicleType:"sedan",      yearOfManufacture:2018, region:"siem_reap",      driverAge:42, accidentHistory:false, coverage:"full",      tier:"standard" },
  { id:"P3", label:"HCM Sedan (Acc)", vehicleType:"sedan",      yearOfManufacture:2017, region:"ho_chi_minh",    driverAge:35, accidentHistory:true,  coverage:"full",      tier:"standard" },
  { id:"P4", label:"Hanoi SUV",       vehicleType:"suv",        yearOfManufacture:2022, region:"hanoi",          driverAge:45, accidentHistory:false, coverage:"full",      tier:"premium"  },
  { id:"P5", label:"Rural Truck",     vehicleType:"truck",      yearOfManufacture:2015, region:"rural_cambodia", driverAge:38, accidentHistory:false, coverage:"ctpl_only", tier:"basic"    },
  { id:"P6", label:"Da Nang SUV",     vehicleType:"suv",        yearOfManufacture:2021, region:"da_nang",        driverAge:50, accidentHistory:false, coverage:"full",      tier:"standard" },
  { id:"P7", label:"Battambang Bike", vehicleType:"motorcycle", yearOfManufacture:2012, region:"battambang",     driverAge:22, accidentHistory:true,  coverage:"ctpl_only", tier:"basic"    },
  { id:"P8", label:"HCMC Truck",      vehicleType:"truck",      yearOfManufacture:2019, region:"ho_chi_minh",    driverAge:55, accidentHistory:false, coverage:"full",      tier:"premium"  },
];

// ─── Labels & helpers ─────────────────────────────────────────────────────────
const REGION_LABELS = {
  phnom_penh:"Phnom Penh", siem_reap:"Siem Reap", battambang:"Battambang",
  sihanoukville:"Sihanoukville", kampong_cham:"Kampong Cham", rural_cambodia:"Rural Cambodia",
  ho_chi_minh:"Ho Chi Minh City", hanoi:"Hanoi", da_nang:"Da Nang", can_tho:"Can Tho", hai_phong:"Hai Phong",
};
const VEHICLE_LABELS  = { motorcycle:"Motorcycle", sedan:"Sedan", suv:"SUV / Crossover", truck:"Truck / Van" };
const COVERAGE_LABELS = { ctpl_only:"CTPL Only", full:"Full Coverage" };
const TIER_LABELS     = { basic:"Basic", standard:"Standard", premium:"Premium", full:"Full Protection" };
const AGE_BRACKET_LABELS = { under25:"18–24", age25to34:"25–34", age35to44:"35–44", age45to54:"45–54", age55to64:"55–64", over65:"65+" };
const VA_BRACKET_LABELS  = { new:"0–2 yr", young:"3–5 yr", mid:"6–10 yr", mature:"11–15 yr", old:"16–20 yr", vintage:"21+ yr" };

const fmtVND = n => "₫" + Math.round(n).toLocaleString();
const fmtPct = n => (n * 100).toFixed(1) + "%";
const fmtX   = n => n.toFixed(3) + "×";

// ─── Shared sub-components ────────────────────────────────────────────────────
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
  return (
    <tr style={{ background: isTotal ? "#f0f4ff" : "transparent", borderTop: isTotal ? `1px solid ${BORDER}` : "none" }}>
      <td style={{ padding: "7px 12px", fontSize: 13, color: TXT, fontWeight: isTotal ? 600 : 400 }}>{label}</td>
      <td style={{ padding: "7px 12px", textAlign: "right" }}>
        <span style={{ fontSize: 13, fontWeight: isTotal ? 700 : 500,
          color: isTotal ? NAVY : value > 1 ? ERR : value < 1 ? OK : TXT2,
          background: isTotal ? "transparent" : value > 1 ? "#fef2f2" : value < 1 ? "#f0fdf4" : "transparent",
          padding: "2px 8px", borderRadius: 4 }}>{fmtX(value)}</span>
      </td>
    </tr>
  );
}

// ─── Tab 1: Quote Lab ─────────────────────────────────────────────────────────
function QuoteLab({ coeffs }) {
  const [form, setForm] = useState({
    vehicleType:"sedan", yearOfManufacture:2019, region:"phnom_penh",
    driverAge:35, accidentHistory:false, coverage:"full", tier:"standard",
  });
  const [result, setResult]   = useState(null);
  const [apiResult, setApi]   = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const runQuote = useCallback(async () => {
    setLoading(true); setApi(null);
    setResult(computeGLM(form, coeffs));
    try {
      const res = await fetch(`${API_URL}/api/v1/auto/price`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ vehicle_type:form.vehicleType, year_of_manufacture:+form.yearOfManufacture,
          region:form.region, driver_age:+form.driverAge, accident_history:form.accidentHistory,
          coverage:form.coverage, tier:form.tier, family_size:1, reference_year:2024 }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) setApi(await res.json());
    } catch (_) {}
    setLoading(false);
  }, [form, coeffs]);

  // Re-compute instantly when coeffs change while result is shown
  const liveResult = result ? computeGLM(form, coeffs) : null;
  const finalPrice = apiResult ? apiResult.final_price : liveResult?.glmPrice;
  const margin = apiResult ? apiResult.margin
    : liveResult ? (liveResult.glmPrice - liveResult.riskAdjusted) / liveResult.glmPrice : 0;

  const IS = { width:"100%", padding:"9px 12px", borderRadius:8, border:`1.5px solid ${BORDER}`,
    fontSize:14, fontFamily:"inherit", outline:"none", background:WHITE, color:TXT, boxSizing:"border-box" };
  const LS = { display:"block", fontSize:12, fontWeight:600, color:TXT2, marginBottom:5,
    textTransform:"uppercase", letterSpacing:0.5 };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"360px 1fr", gap:24 }}>
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, padding:24 }}>
        <div style={{ fontSize:15, fontWeight:700, color:NAVY, marginBottom:20 }}>Vehicle Profile</div>
        <div style={{ display:"grid", gap:16 }}>
          <div><label style={LS}>Vehicle Type</label>
            <select style={IS} value={form.vehicleType} onChange={e => set("vehicleType", e.target.value)}>
              {Object.entries(VEHICLE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div><label style={LS}>Year of Manufacture</label>
            <input type="number" style={IS} value={form.yearOfManufacture} min={1980} max={2025}
              onChange={e => set("yearOfManufacture", +e.target.value)} /></div>
          <div><label style={LS}>Region</label>
            <select style={IS} value={form.region} onChange={e => set("region", e.target.value)}>
              <optgroup label="Cambodia">
                {["phnom_penh","siem_reap","battambang","sihanoukville","kampong_cham","rural_cambodia"].map(r =>
                  <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
              </optgroup>
              <optgroup label="Vietnam">
                {["ho_chi_minh","hanoi","da_nang","can_tho","hai_phong"].map(r =>
                  <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
              </optgroup>
            </select></div>
          <div><label style={LS}>Driver Age</label>
            <input type="number" style={IS} value={form.driverAge} min={18} max={75}
              onChange={e => set("driverAge", +e.target.value)} /></div>
          <div><label style={LS}>Coverage</label>
            <select style={IS} value={form.coverage} onChange={e => set("coverage", e.target.value)}>
              {Object.entries(COVERAGE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div><label style={LS}>Tier</label>
            <select style={IS} value={form.tier} onChange={e => set("tier", e.target.value)}>
              {Object.entries(TIER_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div><label style={LS}>Prior Accident?</label>
            <div style={{ display:"flex", gap:12 }}>
              {[["No",false],["Yes",true]].map(([lbl,val]) => (
                <button key={lbl} onClick={() => set("accidentHistory", val)} style={{
                  flex:1, padding:"9px 0", borderRadius:8,
                  border:`1.5px solid ${form.accidentHistory===val ? NAVY : BORDER}`,
                  background: form.accidentHistory===val ? NAVY : WHITE,
                  color: form.accidentHistory===val ? WHITE : TXT2,
                  fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>{lbl}</button>
              ))}
            </div></div>
          <button onClick={runQuote} disabled={loading} style={{
            width:"100%", padding:12, borderRadius:10,
            background: loading ? "#9ca3af" : GOLD, color:NAVY, border:"none",
            fontSize:15, fontWeight:700, cursor: loading ? "not-allowed" : "pointer",
            fontFamily:"inherit", marginTop:4 }}>
            {loading ? "Computing…" : "Calculate Premium"}
          </button>
        </div>
      </div>

      <div>
        {!liveResult ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%",
            background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, minHeight:300 }}>
            <div style={{ textAlign:"center", color:TXT2 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
              <div style={{ fontSize:15, fontWeight:600 }}>Fill in the profile and calculate</div>
              <div style={{ fontSize:13, marginTop:4 }}>Full GLM breakdown will appear here</div>
            </div>
          </div>
        ) : (
          <div style={{ display:"grid", gap:16 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
              <StatCard label="GLM Price"     value={fmtVND(liveResult.glmPrice)} sub="Before ML adjustment" />
              <StatCard label="Final Premium" value={fmtVND(finalPrice)} sub={apiResult ? "GLM + ML adjusted" : "GLM only"} color={GOLD} />
              <StatCard label="Margin"        value={fmtPct(margin)} sub="Above expected claims" color={margin > 0.15 ? OK : WARN} />
            </div>

            {/* ML badge */}
            <div style={{ display:"inline-flex", alignItems:"center", gap:8,
              background: apiResult ? NAVY : "#374151", borderRadius:8, padding:"8px 14px" }}>
              <span style={{ fontSize:18 }}>{apiResult ? "🤖" : "📐"}</span>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:GOLD }}>
                  {apiResult ? `ML Model · Accuracy: ${apiResult.model_accuracy_pct}%` : "GLM Only · ML not yet trained"}
                </div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)" }}>
                  {apiResult ? `Adjustment: ${apiResult.ml_adjustment >= 0 ? "+" : ""}${(apiResult.ml_adjustment*100).toFixed(1)}%`
                    : "Run python -m app.ml.train_model to enable ML layer"}
                </div>
              </div>
            </div>

            <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
              <div style={{ background:NAVY, padding:"12px 20px", color:WHITE, fontSize:14, fontWeight:700 }}>GLM Pricing Breakdown</div>
              <div style={{ padding:"12px 20px", background:"#fafbff", borderBottom:`1px solid ${BORDER}` }}>
                <div style={{ fontSize:11, fontWeight:700, color:TXT2, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Base Rates</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                  {[["Frequency", liveResult.baseFrequency+"/yr"],["Severity",fmtVND(liveResult.baseSeverity)],["Base Pure Premium",fmtVND(liveResult.basePure)]].map(([l,v]) => (
                    <div key={l}><span style={{ fontSize:11, color:TXT2 }}>{l}</span><br />
                      <span style={{ fontSize:14, fontWeight:600, color:TXT }}>{v}</span></div>
                  ))}
                </div>
              </div>
              <div style={{ padding:"0 0 12px" }}>
                <div style={{ padding:"12px 20px 4px", fontSize:11, fontWeight:700, color:TXT2, textTransform:"uppercase", letterSpacing:1 }}>Risk Multipliers</div>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <tbody>
                    <MultRow label={`Vehicle Age (${liveResult.vaBracket})`}           value={liveResult.multipliers.vehicleAge} />
                    <MultRow label={`Driver Age (${liveResult.drvBracket})`}           value={liveResult.multipliers.driverAge} />
                    <MultRow label={`Region (${REGION_LABELS[form.region]})`}          value={liveResult.multipliers.region} />
                    <MultRow label={`Accident (${form.accidentHistory ? "Yes":"No"})`} value={liveResult.multipliers.accident} />
                    <MultRow label={`Coverage (${COVERAGE_LABELS[form.coverage]})`}    value={liveResult.multipliers.coverage} />
                    <MultRow label="Combined" value={liveResult.multipliers.combined} isTotal />
                  </tbody>
                </table>
              </div>
              <div style={{ padding:"12px 20px", borderTop:`1px solid ${BORDER}` }}>
                <div style={{ fontSize:11, fontWeight:700, color:TXT2, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Price Build-up</div>
                {[
                  ["Risk-Adjusted Pure Premium", fmtVND(liveResult.riskAdjusted), TXT],
                  [`Loading (+${fmtPct(liveResult.loadingFactor)})`, fmtVND(liveResult.loaded - liveResult.riskAdjusted), WARN],
                  ["Loaded Premium", fmtVND(liveResult.loaded), TXT],
                  [`Tier (${TIER_LABELS[form.tier]} × ${fmtX(liveResult.tierMult)})`, fmtVND(liveResult.tiered), TXT],
                  ["Deductible Credit", `−${fmtVND(liveResult.dedCredit)}`, OK],
                ].map(([l,v,c]) => (
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${BORDER}`, fontSize:13 }}>
                    <span style={{ color:TXT2 }}>{l}</span><span style={{ fontWeight:600, color:c }}>{v}</span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0 0", fontSize:15, fontWeight:700 }}>
                  <span style={{ color:NAVY }}>GLM Final Price</span>
                  <span style={{ color:NAVY }}>{fmtVND(liveResult.glmPrice)}</span>
                </div>
                {apiResult && <>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontSize:13 }}>
                    <span style={{ color:TXT2 }}>ML Adjustment ({apiResult.ml_adjustment >= 0 ? "+" : ""}{(apiResult.ml_adjustment*100).toFixed(1)}%)</span>
                    <span style={{ fontWeight:600, color: apiResult.ml_adjustment < 0 ? OK : ERR }}>{fmtVND(apiResult.ml_adjustment_vnd)}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0 0", fontSize:16, fontWeight:700, borderTop:`2px solid ${GOLD}` }}>
                    <span style={{ color:NAVY }}>Final Price (ML)</span>
                    <span style={{ color:GOLD }}>{fmtVND(apiResult.final_price)}</span>
                  </div>
                </>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: Office Profiles ───────────────────────────────────────────────────
function OfficeProfiles({ coeffs }) {
  const results = useMemo(() => OFFICE_PROFILES.map(p => ({ ...p, glm: computeGLM(p, coeffs) })), [coeffs]);
  const totalPremium = results.reduce((s,r) => s + r.glm.glmPrice, 0);
  const avgMargin    = results.reduce((s,r) => s + (r.glm.glmPrice - r.glm.riskAdjusted) / r.glm.glmPrice, 0) / results.length;
  const avgPremium   = totalPremium / results.length;

  return (
    <div style={{ display:"grid", gap:20 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
        <StatCard label="Portfolio Premium"   value={fmtVND(totalPremium)} sub="8 profiles combined" />
        <StatCard label="Avg Premium / Policy" value={fmtVND(avgPremium)} sub="All tiers & types" color={GOLD} />
        <StatCard label="Avg GLM Margin"       value={fmtPct(avgMargin)}  sub="Across all profiles" color={OK} />
      </div>

      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <div style={{ background:NAVY, padding:"12px 20px", color:WHITE, fontSize:14, fontWeight:700 }}>
          MODEL_AUTO_OFFICE — Representative Personas
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ background:LTGRAY }}>
              {["#","Profile","Type","YOM","Region","Age","Acc.","Coverage","Tier","Base Pure","Combined ×","Loaded","GLM Price","Margin"].map(h => (
                <th key={h} style={{ padding:"10px 12px", textAlign: h==="#"||h==="Acc." ? "center":"left",
                  fontWeight:700, color:TXT2, fontSize:11, textTransform:"uppercase", letterSpacing:0.5,
                  borderBottom:`1px solid ${BORDER}`, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {results.map((r,i) => {
                const m = (r.glm.glmPrice - r.glm.riskAdjusted) / r.glm.glmPrice;
                return (
                  <tr key={r.id} style={{ borderBottom:`1px solid ${BORDER}`, background: i%2===0 ? WHITE : "#fafbff" }}>
                    <td style={{ padding:"10px 12px", textAlign:"center", color:TXT2, fontSize:12 }}>{r.id}</td>
                    <td style={{ padding:"10px 12px", fontWeight:600, color:NAVY, whiteSpace:"nowrap" }}>{r.label}</td>
                    <td style={{ padding:"10px 12px" }}>{VEHICLE_LABELS[r.vehicleType]}</td>
                    <td style={{ padding:"10px 12px" }}>{r.yearOfManufacture}</td>
                    <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>{REGION_LABELS[r.region]}</td>
                    <td style={{ padding:"10px 12px" }}>{r.driverAge}</td>
                    <td style={{ padding:"10px 12px", textAlign:"center" }}>{r.accidentHistory ? "✓":"—"}</td>
                    <td style={{ padding:"10px 12px" }}>{COVERAGE_LABELS[r.coverage]}</td>
                    <td style={{ padding:"10px 12px" }}>
                      <span style={{ background:"#f0f4ff", color:NAVY, padding:"2px 8px", borderRadius:4, fontSize:12, fontWeight:600 }}>
                        {TIER_LABELS[r.tier]}
                      </span>
                    </td>
                    <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>{fmtVND(r.glm.basePure)}</td>
                    <td style={{ padding:"10px 12px", textAlign:"right" }}>
                      <span style={{ color: r.glm.multipliers.combined > 1.2 ? ERR : r.glm.multipliers.combined < 0.9 ? OK : TXT2, fontWeight:600 }}>
                        {fmtX(r.glm.multipliers.combined)}
                      </span>
                    </td>
                    <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>{fmtVND(r.glm.loaded)}</td>
                    <td style={{ padding:"10px 12px", fontWeight:700, color:NAVY, whiteSpace:"nowrap" }}>{fmtVND(r.glm.glmPrice)}</td>
                    <td style={{ padding:"10px 12px" }}>
                      <span style={{ color: m>0.20 ? OK : m>0.10 ? WARN : ERR, fontWeight:600 }}>{fmtPct(m)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {["motorcycle","sedan","suv","truck"].map(vt => {
          const g = results.filter(r => r.vehicleType === vt);
          if (!g.length) return null;
          const avg = g.reduce((s,r) => s + r.glm.glmPrice, 0) / g.length;
          return (
            <div key={vt} style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"16px 18px" }}>
              <div style={{ fontSize:11, color:TXT2, textTransform:"uppercase", letterSpacing:1 }}>Avg — {VEHICLE_LABELS[vt]}</div>
              <div style={{ fontSize:20, fontWeight:700, color:NAVY, marginTop:4 }}>{fmtVND(avg)}</div>
              <div style={{ fontSize:12, color:TXT2, marginTop:2 }}>{g.length} profile{g.length>1?"s":""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab 3: Coefficient Editor ────────────────────────────────────────────────
function CoeffEditor({ coeffs, setCoeffs }) {

  // deep-set helper: setPath("regionMult.hanoi", 1.25)
  const setPath = (path, rawVal) => {
    const val = parseFloat(rawVal);
    if (isNaN(val) || val < 0) return;
    setCoeffs(prev => {
      const next = deepClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = val;
      return next;
    });
  };

  const isDirty = JSON.stringify(coeffs) !== JSON.stringify(DEFAULTS);

  const saveDraft = () => {
    const draft = { coeffs, savedAt: new Date().toISOString(), version: "draft" };
    localStorage.setItem(LS_KEY, JSON.stringify(draft));
    alert("Draft saved to browser storage.\nIt will be loaded automatically next time you open the lab.");
  };

  const resetDefaults = () => {
    if (confirm("Reset all coefficients to actuarial defaults? Your draft will be lost."))
      setCoeffs(deepClone(DEFAULTS));
  };

  const numInput = (path, val, defaultVal, opts = {}) => {
    const changed = Math.abs(val - defaultVal) > 1e-9;
    return (
      <div style={{ position:"relative" }}>
        <input
          type="number" value={val} step={opts.step ?? 0.01} min={opts.min ?? 0} max={opts.max ?? 10}
          onChange={e => setPath(path, e.target.value)}
          style={{ width:"100%", padding:"6px 8px", borderRadius:6, boxSizing:"border-box",
            border:`1.5px solid ${changed ? PURPLE : BORDER}`,
            background: changed ? "#faf5ff" : WHITE,
            fontSize:13, fontFamily:"inherit", outline:"none", color:TXT,
            fontWeight: changed ? 700 : 400 }}
        />
        {changed && (
          <span style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)",
            fontSize:10, color:PURPLE, fontWeight:700 }}>
            was {defaultVal}
          </span>
        )}
      </div>
    );
  };

  const SectionHeader = ({ title, source }) => (
    <>
      <div style={{ background:NAVY, padding:"10px 18px", color:WHITE, fontSize:14, fontWeight:700 }}>{title}</div>
      {source && <div style={{ padding:"6px 18px", background:"#fafbff", borderBottom:`1px solid ${BORDER}`, fontSize:11, color:TXT2 }}>📚 {source}</div>}
    </>
  );

  const TH = ({ children }) => (
    <th style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:700,
      color:TXT2, textTransform:"uppercase", letterSpacing:0.5,
      background:LTGRAY, borderBottom:`1px solid ${BORDER}` }}>{children}</th>
  );

  return (
    <div style={{ display:"grid", gap:20 }}>

      {/* Toolbar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {isDirty
            ? <span style={{ background:"#faf5ff", border:`1px solid ${PURPLE}`, color:PURPLE,
                padding:"4px 12px", borderRadius:20, fontSize:12, fontWeight:700 }}>
                ● Unsaved changes
              </span>
            : <span style={{ background:"#f0fdf4", border:`1px solid ${OK}`, color:"#166534",
                padding:"4px 12px", borderRadius:20, fontSize:12, fontWeight:700 }}>
                ✓ Default values
              </span>
          }
          <span style={{ fontSize:12, color:TXT2 }}>
            Purple border = modified value · "was X" shows original
          </span>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={resetDefaults} style={{
            padding:"8px 16px", borderRadius:8, border:`1.5px solid ${BORDER}`,
            background:WHITE, color:TXT2, fontSize:13, fontWeight:600,
            cursor:"pointer", fontFamily:"inherit" }}>↺ Reset to defaults</button>
          <button onClick={saveDraft} disabled={!isDirty} style={{
            padding:"8px 20px", borderRadius:8, border:"none",
            background: isDirty ? GOLD : "#d1d5db", color: isDirty ? NAVY : "#9ca3af",
            fontSize:13, fontWeight:700, cursor: isDirty ? "pointer" : "not-allowed",
            fontFamily:"inherit" }}>💾 Save draft</button>
        </div>
      </div>

      {/* 1. Base Rates */}
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <SectionHeader title="Base Rates — Frequency (claims/yr) & Severity (VND/claim)"
          source="Vietnam Insurance Registry 2024 Table 3.1; ABeam SE Asia Motor 2023 p.47-49" />
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr><TH>Vehicle Type</TH><TH>Frequency</TH><TH>Severity (VND)</TH><TH>Base Pure Premium</TH></tr></thead>
          <tbody>
            {Object.entries(coeffs.base).map(([vt, r], i) => (
              <tr key={vt} style={{ borderBottom:`1px solid ${BORDER}`, background: i%2===0 ? WHITE : "#fafbff" }}>
                <td style={{ padding:"10px 12px", fontWeight:600, color:NAVY }}>{VEHICLE_LABELS[vt]}</td>
                <td style={{ padding:"8px 12px", width:140 }}>
                  {numInput(`base.${vt}.frequency`, r.frequency, DEFAULTS.base[vt].frequency, { step:0.01, min:0.001, max:1 })}
                </td>
                <td style={{ padding:"8px 12px", width:180 }}>
                  {numInput(`base.${vt}.severity`, r.severity, DEFAULTS.base[vt].severity, { step:1_000_000, min:1_000_000, max:500_000_000 })}
                </td>
                <td style={{ padding:"10px 12px", fontWeight:600, color:TXT2 }}>{fmtVND(r.frequency * r.severity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 2. Loading Factors */}
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <SectionHeader title="Loading Factors (expense + profit above expected loss)"
          source="ABeam SE Asia 2023; Vietnam Insurance Registry 2024" />
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr><TH>Vehicle Type</TH><TH>Loading Factor</TH><TH>Implied Loss Ratio</TH></tr></thead>
          <tbody>
            {Object.entries(coeffs.loading).map(([vt, l], i) => (
              <tr key={vt} style={{ borderBottom:`1px solid ${BORDER}`, background: i%2===0 ? WHITE : "#fafbff" }}>
                <td style={{ padding:"10px 12px", fontWeight:600, color:NAVY }}>{VEHICLE_LABELS[vt]}</td>
                <td style={{ padding:"8px 12px", width:160 }}>
                  {numInput(`loading.${vt}`, l, DEFAULTS.loading[vt], { step:0.01, min:0.05, max:0.80 })}
                </td>
                <td style={{ padding:"10px 12px", color:TXT2 }}>{fmtPct(1 - l)} paid out in claims</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 3. Accident History */}
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <SectionHeader title="Accident History Multipliers"
          source="ABeam SE Asia 2023 Table 5.6; DirectAsia Vietnam tariffs 2024" />
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr><TH>History</TH><TH>Multiplier</TH></tr></thead>
          <tbody>
            {[["no","No prior claim (good-driver discount)"],["yes","Prior claim (loading applied)"]].map(([k,lbl],i) => (
              <tr key={k} style={{ borderBottom:`1px solid ${BORDER}`, background: i%2===0 ? WHITE : "#fafbff" }}>
                <td style={{ padding:"10px 12px", color:TXT }}>{lbl}</td>
                <td style={{ padding:"8px 12px", width:160 }}>
                  {numInput(`accident.${k}`, coeffs.accident[k], DEFAULTS.accident[k], { step:0.01, min:0.1, max:5 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 4. Tier Multipliers */}
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <SectionHeader title="Tier Multipliers & Deductible Credits"
          source="DirectAsia VN, Bao Viet, PTI tariffs 2024; ABeam 2023 appendix" />
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr><TH>Tier</TH><TH>Multiplier</TH><TH>Deductible Credit (VND)</TH></tr></thead>
          <tbody>
            {Object.entries(coeffs.tierMult).map(([t, m], i) => (
              <tr key={t} style={{ borderBottom:`1px solid ${BORDER}`, background: i%2===0 ? WHITE : "#fafbff" }}>
                <td style={{ padding:"10px 12px", fontWeight:600, color:NAVY }}>{TIER_LABELS[t]}</td>
                <td style={{ padding:"8px 12px", width:160 }}>
                  {numInput(`tierMult.${t}`, m, DEFAULTS.tierMult[t], { step:0.05, min:0.1, max:5 })}
                </td>
                <td style={{ padding:"8px 12px", width:200 }}>
                  {numInput(`deductible.${t}`, coeffs.deductible[t], DEFAULTS.deductible[t], { step:500_000, min:0, max:20_000_000 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 5. Region Multipliers */}
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <SectionHeader title="Region Multipliers"
          source="Vietnam Insurance Registry 2024 Table 6.1; Statista Cambodia 2024; ABeam 2023" />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0 }}>
          {[
            { group:"Cambodia", keys:["phnom_penh","siem_reap","battambang","sihanoukville","kampong_cham","rural_cambodia"] },
            { group:"Vietnam",  keys:["ho_chi_minh","hanoi","da_nang","can_tho","hai_phong"] },
          ].map(({ group, keys }) => (
            <div key={group} style={{ borderRight: group==="Cambodia" ? `1px solid ${BORDER}` : "none" }}>
              <div style={{ padding:"8px 16px", fontSize:11, fontWeight:700, color:TXT2, background:LTGRAY,
                textTransform:"uppercase", letterSpacing:1, borderBottom:`1px solid ${BORDER}` }}>{group}</div>
              {keys.map((r, i) => (
                <div key={r} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"8px 16px", borderBottom:`1px solid ${BORDER}`, background: i%2===0 ? WHITE : "#fafbff" }}>
                  <span style={{ fontSize:13, color:TXT }}>{REGION_LABELS[r]}</span>
                  <div style={{ width:140 }}>
                    {numInput(`regionMult.${r}`, coeffs.regionMult[r], DEFAULTS.regionMult[r], { step:0.01, min:0.2, max:3 })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 6. Driver Age Multipliers */}
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <SectionHeader title="Driver Age Multipliers (U-shaped risk curve)"
          source="ABeam SE Asia 2023 Table 5.4; Statista Cambodia 2024" />
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr><TH>Age Bracket</TH><TH>Multiplier</TH></tr></thead>
          <tbody>
            {Object.entries(coeffs.driverAgeMult).map(([k, v], i) => (
              <tr key={k} style={{ borderBottom:`1px solid ${BORDER}`, background: i%2===0 ? WHITE : "#fafbff" }}>
                <td style={{ padding:"10px 12px", color:TXT }}>{AGE_BRACKET_LABELS[k]}</td>
                <td style={{ padding:"8px 12px", width:160 }}>
                  {numInput(`driverAgeMult.${k}`, v, DEFAULTS.driverAgeMult[k], { step:0.01, min:0.1, max:5 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 7. Vehicle Age Multipliers */}
      <div style={{ background:WHITE, border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <SectionHeader title="Vehicle Age Multipliers"
          source="ABeam SE Asia Motor Insurance Report 2023 Table 5.3" />
        {Object.entries(coeffs.vehicleAgeMult).map(([vt, brackets]) => (
          <div key={vt} style={{ borderBottom:`1px solid ${BORDER}` }}>
            <div style={{ padding:"8px 16px", fontSize:12, fontWeight:700, color:NAVY, background:"#f8faff",
              borderBottom:`1px solid ${BORDER}` }}>{VEHICLE_LABELS[vt]}</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:0 }}>
              {Object.entries(brackets).map(([bracket, val], i) => (
                <div key={bracket} style={{ padding:"10px 12px",
                  borderRight: i < 5 ? `1px solid ${BORDER}` : "none",
                  background: i%2===0 ? WHITE : "#fafbff" }}>
                  <div style={{ fontSize:11, color:TXT2, marginBottom:6 }}>{VA_BRACKET_LABELS[bracket]}</div>
                  {numInput(`vehicleAgeMult.${vt}.${bracket}`, val, DEFAULTS.vehicleAgeMult[vt][bracket], { step:0.01, min:0.1, max:5 })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AutoPricingLab() {
  const [tab, setTab]       = useState("quote");
  const [coeffs, setCoeffs] = useState(loadInitialCoeffs);

  const isDirty = JSON.stringify(coeffs) !== JSON.stringify(DEFAULTS);

  const tabs = [
    { id:"quote",    label:"Quote Lab",       icon:"🧮" },
    { id:"profiles", label:"Office Profiles", icon:"👥" },
    { id:"coeffs",   label: isDirty ? "Coefficients ●" : "Coefficients", icon:"📋" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:LTGRAY, fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ background:`linear-gradient(135deg, ${NAVY_D} 0%, ${NAVY} 100%)`, padding:"32px 32px 0" }}>
        <div style={{ maxWidth:1300, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
            <span style={{ fontSize:28 }}>🚗</span>
            <div>
              <div style={{ fontSize:22, fontWeight:800, color:WHITE }}>
                Auto Pricing Lab <span style={{ color:GOLD }}>v2</span>
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", marginTop:2 }}>
                GLM + ML Hybrid · Cambodia & Vietnam · Actuarial Coefficient Engine
              </div>
            </div>
          </div>
          <div style={{ display:"flex", gap:4, marginTop:24 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding:"10px 22px", borderRadius:"8px 8px 0 0", border:"none", cursor:"pointer",
                fontFamily:"inherit", fontSize:14, fontWeight:600, transition:"all 0.15s",
                background: tab===t.id ? WHITE : "rgba(255,255,255,0.08)",
                color: tab===t.id ? NAVY : "rgba(255,255,255,0.7)",
              }}>{t.icon} {t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1300, margin:"0 auto", padding:"24px 32px 48px" }}>
        {tab === "quote"    && <QuoteLab     coeffs={coeffs} />}
        {tab === "profiles" && <OfficeProfiles coeffs={coeffs} />}
        {tab === "coeffs"   && <CoeffEditor  coeffs={coeffs} setCoeffs={setCoeffs} />}
      </div>
    </div>
  );
}
