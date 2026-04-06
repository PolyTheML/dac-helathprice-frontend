# Auto Pricing Lab v2 — Complete Architecture

**Production-grade dynamic pricing system for auto insurance with GLM + ML hybrid approach**

---

## 🏗️ Project Structure

```
frontend (React 19 + TypeScript)
├── src/
│   ├── shared/
│   │   ├── COEFF_AUTO.ts          ← Actuarial coefficients (all vehicle types & risk factors)
│   │   ├── constants.ts            ← Shared enums, validation limits
│   │   └── README.md               ← How to use shared config
│   ├── types/
│   │   └── auto.ts                 ← TypeScript interfaces (VehicleProfile, Pricing, etc.)
│   ├── components/
│   │   └── AutoPricingLab.tsx       ← 3-panel dashboard (Step 8)
│   └── ...existing files

backend (FastAPI + Python)
├── app/
│   ├── pyproject.toml              ← Dependency & tool configuration
│   ├── pricing_engine/
│   │   ├── __init__.py
│   │   ├── glm_pricing.py           ← compute_glm_price() (Step 3)
│   │   └── final_pricing.py         ← compute_final_price() (Step 5)
│   ├── ml/
│   │   ├── __init__.py
│   │   ├── train_model.py           ← LightGBM training (Step 4)
│   │   └── inference.py             ← ML adjustment computation
│   ├── data/
│   │   ├── __init__.py
│   │   ├── features.py              ← Feature extraction (Step 12)
│   │   └── validation.py            ← Feature consistency checks
│   ├── feedback/
│   │   ├── __init__.py
│   │   ├── metrics.py               ← Loss ratio tracking (Step 6)
│   │   └── claims.py                ← Claims aggregation
│   ├── monitoring/
│   │   ├── __init__.py
│   │   └── monitor.py               ← Drift detection (Step 7)
│   ├── governance/
│   │   ├── __init__.py
│   │   └── versions.py              ← Model & coefficient versioning (Step 11)
│   └── routes/
│       ├── pricing.py               ← POST /api/v1/auto/price (Step 10)
│       └── lab.py                   ← Lab endpoints for optimization

shared/
├── COEFF_AUTO.py                    ← Python version of coefficients
└── types.py                         ← Python type definitions
```

---

## 🔄 Data Flow (Glass-Box + ML Hybrid)

```
VehicleProfile (input)
    ↓
┌─────────────────────────────────────────────────┐
│ GLM Pricing Engine                              │
│ - Apply base rates (frequency × severity)       │
│ - Apply risk multipliers (age, region, etc.)    │
│ - Load premium                                  │
│ OUTPUT: glm_price, breakdown                    │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ ML Adjustment Layer                             │
│ - LightGBM inference on residuals               │
│ - Predict: GLM_error = actual - glm_prediction  │
│ OUTPUT: ml_adjustment (-10% to +15%)            │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ Final Price                                     │
│ final_price = glm_price × (1 + ml_adjustment)  │
│ margin = (final - expected_cost) / final       │
│ OUTPUT: full breakdown, margin, confidence      │
└─────────────────────────────────────────────────┘
    ↓
Feedback Loop ← Claims Data
    ↓
Monitoring & Drift Detection
    ↓
Alert / Model Retrain Decision
```

---

## 🚀 13-Step Implementation Roadmap

| Step | Title | Files | Status |
|------|-------|-------|--------|
| 1 | **Project Structure** | `/shared`, `/ml`, `/data`, `/pricing_engine`, `/feedback`, `/monitoring`, `/governance` | ✅ Complete |
| 2 | **COEFF_AUTO.ts** | `src/shared/COEFF_AUTO.ts` | ✅ Complete |
| 3 | **GLM Pricing** | `app/pricing_engine/glm_pricing.py` | ⏳ Next |
| 4 | **ML Training** | `app/ml/train_model.py` | ⏳ Pending |
| 5 | **Final Pricing** | `app/pricing_engine/final_pricing.py` | ⏳ Pending |
| 6 | **Feedback Loop** | `app/feedback/metrics.py`, DB tables | ⏳ Pending |
| 7 | **Monitoring** | `app/monitoring/monitor.py` | ⏳ Pending |
| 8 | **Frontend (UI)** | `src/components/AutoPricingLab.tsx` | ⏳ Pending |
| 9 | **Portfolio Optimizer** | `app/lab/optimizer.py` | ⏳ Pending |
| 10 | **Production API** | `app/routes/pricing.py` | ⏳ Pending |
| 11 | **Governance** | `app/governance/versions.py`, DB tables | ⏳ Pending |
| 12 | **Data Layer** | `app/data/features.py` | ⏳ Pending |
| 13 | **Snapshots & Export** | Export utilities | ⏳ Pending |

---

## 📋 Database Schema Preview

### Core Tables

**`hp_auto_coefficients`** (Governance)
```sql
id (uuid)
version (int)
coefficients (JSONB) -- full COEFF_AUTO snapshot
status (enum: draft | approved | active | archived)
created_by (varchar)
created_at (timestamp)
description (text)
approved_by (varchar, nullable)
approved_at (timestamp, nullable)
```

**`hp_auto_policies`** (Claims Tracking)
```sql
id (uuid)
policy_number (varchar, unique)
vehicle_type (enum)
region (enum)
driver_age (int)
accident_history (bool)
glm_quote (numeric)
ml_adjustment (numeric)
final_premium (numeric)
bound_at (timestamp)
effective_date (date)
expiry_date (date)
```

**`hp_auto_claims`** (Feedback Loop)
```sql
id (uuid)
policy_id (uuid, foreign key)
claim_date (timestamp)
claim_amount (numeric)
claim_type (varchar)
estimated_vs_actual (numeric)
created_at (timestamp)
```

**`hp_auto_models`** (ML Versioning)
```sql
id (uuid)
version (int)
model_type (enum: glm | ml_adjustment | final_pricing)
ml_model_data (bytea) -- pickled LightGBM model
training_metrics (JSONB) -- mape, r2, rmse
status (enum)
created_by (varchar)
created_at (timestamp)
```

**`hp_auto_monitoring`** (Drift & Alerts)
```sql
id (uuid)
segment (varchar) -- e.g., 'motorcycle_phnom_penh'
metric (varchar) -- 'loss_ratio', 'conversion_rate'
actual_value (numeric)
expected_value (numeric)
deviation_percent (numeric)
alert_level (enum: info | warning | critical)
checked_at (timestamp)
```

---

## 🎯 Key Design Principles

### 1. Glass-Box + ML Hybrid
- **Transparency**: Every price component is visible and explainable
- **Auditability**: Every decision traced back to actuarial logic or data
- **Flexibility**: ML can adjust, but GLM is always the foundation

### 2. Coefficient Versioning & Governance
- All coefficient changes go through approval workflow
- Version history allows rollback or A/B testing
- Audit trail for compliance & thesis documentation

### 3. Training ≠ Production Features
- Feature engineering (`app/data/features.py`) is single source of truth
- Same features used in training and inference
- Prevents training-serving skew

### 4. Feedback Loop Closes the Loop
- Every quote → policy → claim → loss ratio feedback
- Monitor segments for drift
- Trigger retraining when performance degrades

### 5. Portfolio Optimization for Business Levers
- Actuaries test "what-if" scenarios
- Optimize for target margin while respecting bounds
- No changes to production without approval

---

## 🧮 Coefficient Structure (COEFF_AUTO)

Example for motorcycle in Phnom Penh:

```typescript
COEFF_AUTO = {
  base: {
    motorcycle: { frequency: 0.18, severity: 2800 },  // claims/year, USD
    sedan: { frequency: 0.08, severity: 3500 },
    suv: { frequency: 0.07, severity: 4200 },
    truck: { frequency: 0.12, severity: 5800 },
  },
  multipliers: {
    vehicleAge: {
      motorcycle: { '<3yr': 0.90, '3-6yr': 1.0, ... '>20yr': 1.80 },
      sedan: { ... }
    },
    driverAge: {
      '<25': 1.30, '25-45': 1.0, '45-65': 1.05, '>65': 1.25
    },
    region: {
      phnom_penh: 1.15,
      siem_reap: 1.05,
      rural_cambodia: 0.70,
      ...
    },
    accidentHistory: { yes: 1.50, no: 1.0 },
    coverage: { ctpl_only: 0.60, full: 1.0 },
  },
  loading: {
    motorcycle: 0.32,
    sedan: 0.25,
    suv: 0.28,
    truck: 0.35,
  },
  tier: { basic: 0.70, standard: 1.0, premium: 1.40, full: 2.0 },
  deductible: { basic: 100_000, standard: 200_000, ... }, // VND
}
```

---

## 🏛️ API Endpoints (Step 10+)

### Lab Endpoints (Internal Use)
```
POST /lab/auto/price
  input: VehicleProfile, params?: OverriddenCoefficients
  output: QuoteResponse (full breakdown)

POST /lab/auto/batch-price
  input: VehicleProfile[], params
  output: QuoteResponse[]

POST /lab/auto/optimize
  input: OptimizationConstraint, personas
  output: OptimizationResult[] (top 5)

GET /lab/auto/coefficients
  output: current active COEFF_AUTO

POST /lab/auto/coefficients
  input: updated COEFF_AUTO, description, userId
  output: new coefficient version (draft)

POST /lab/auto/coefficients/{version}/approve
  input: approverId, notes
  output: approved version

GET /lab/auto/monitoring
  output: SegmentMetrics[], DriftAlert[]
```

### Production Endpoint (Customer-Facing)
```
POST /api/v1/auto/price
  input: minimal VehicleProfile
  output: { final_price, margin, confidence_score }
  (no breakdown unless requested)
```

---

## 🔍 Monitoring & Drift Detection

Every segment (vehicle type × region combination) is monitored:

```
Segment: motorcycle_phnom_penh
  Written Premium: 50M VND
  Expected Loss: 35M VND (GLM prediction)
  Actual Loss: 40M VND (claims to date)
  Loss Ratio: 80% (actual / written)
  Expected: 70%
  Deviation: +10% ⚠️ WARNING

Action:
  1. Alert actuary
  2. If deviation > 25% → trigger model retraining
  3. Consider coefficient adjustment (loading +2%)
```

---

## 📈 ML Adjustment Learning

The ML model learns to correct GLM biases:

```
Historical Claims Data:
  Profile: sedan, hanoi, 30yr driver, no accident, standard tier
  GLM Premium: 3,500,000 VND
  Actual Loss: 2,200,000 VND (actual claims + overhead)
  Residual: -1,300,000 VND (GLM over-predicted by 37%)

LightGBM trains on 10,000 profiles:
  Target = actual_loss - glm_premium
  Features = vehicle_age, driver_age, region, accident_history, tier, ...
  
Learned Pattern: "Sedans in hanoi with standard coverage are 35% lower risk than GLM suggests"

Result: ML adjustment = -0.35 (reduce by 35%)
  Final Premium = 3,500,000 × (1 - 0.35) = 2,275,000 VND
  Confidence = 0.87 (model certainty)
```

---

## 🛠️ Development Workflow

1. **Actuary** opens AutoPricingLab
2. **Edits coefficients** (e.g., load factor +2% for motorcycles)
3. **Tests quotes** on MODEL_AUTO_OFFICE (8 representative profiles)
4. **Runs portfolio optimizer** to find ideal balance
5. **Reviews sensitivity** charts (margin vs. load factor)
6. **Saves as draft** version with description
7. **Submits for approval** (email to Dr. Chris)
8. **Once approved**, promotes version to "active"
9. **System applies** to all new quotes immediately
10. **Monitors** segment metrics weekly
11. **If drift detected**, analyzes root cause
12. **If GLM error > threshold**, schedules retraining

---

## 📦 Dependencies

**Frontend** (React)
- TypeScript 5.0+
- React 19
- Vite (build)

**Backend** (Python 3.9+)
- FastAPI 0.104+
- SQLAlchemy 2.0+
- scikit-learn 1.3+
- LightGBM 4.0+
- Pandas 2.0+
- Pydantic 2.0+

---

## ✅ Success Criteria

Each step is complete when:
1. ✅ Full working code (copy-paste ready)
2. ✅ Documented with comments and examples
3. ✅ Integrated with previous steps
4. ✅ Tested locally (at least smoke test)
5. ✅ Committed to git with clear message

---

## 📚 Next: Step 3

**File**: `app/pricing_engine/glm_pricing.py` (backend)

**Task**: Implement `compute_glm_price(profile: VehicleProfile) -> GLMResult` using COEFF_AUTO values.

Logic:
1. Base pure premium = `base[vehicle_type].frequency × base[vehicle_type].severity`
2. Multiply by all applicable risk multipliers (vehicle age, driver age, region, accident history, coverage)
3. Apply loading: `loaded = pure × (1 + loading[vehicle_type])`
4. Apply tier: `tiered = loaded × tier[tier_type]`
5. Subtract deductible credit: `glm_price = tiered - deductible[tier_type]`
6. Return full breakdown (each multiplier visible)

**Key requirement**: Return `GLMResult` with all intermediate steps for frontend transparency display.
