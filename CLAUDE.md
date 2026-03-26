# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (Vite HMR)
npm run build     # Production build
npm run preview   # Preview production build locally
npm run lint      # ESLint check
```

No test suite is configured.

## Architecture

**React 19 SPA** built with Vite. No routing library — navigation is a single `useState` string (`currentPage`) in `App.jsx`.

### Key Files

| File | Role |
|------|------|
| `src/App.jsx` | Shell: navbar, page routing, Home/About/Contact/Admin pages (~53KB) |
| `src/PricingWizard.jsx` | 4-step insurance quote wizard with pricing engine and AI chatbot (~91KB) |

Both files are large monolithic components with inline CSS via template literals and `<style>` tags. All styling is custom — no CSS framework or component library.

### Pricing Engine

The wizard (`PricingWizard.jsx`) has two pricing paths:
1. **Remote**: POST to `https://dac-healthprice-api.onrender.com` (45s timeout, AbortSignal)
2. **Local fallback**: `localPrice()` — frequency-severity model with age, smoking, occupation, condition, and tier multipliers

**Tiers**: Bronze (0.70×), Silver (1.0×), Gold (1.45×), Platinum (2.1×)
**Optional riders**: OPD, Dental, Maternity

### State & Data

- All state is local React hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- Quotes are persisted to `localStorage`
- No Redux, Zustand, or Context API

### Design System

- Colors: Navy `#1a1a2e`, Gold `#f5c563`, White
- Fonts: DM Sans (body), Playfair Display / Instrument Serif (headings) via Google Fonts
- Scroll animations via IntersectionObserver
- Responsive via inline `@media` queries

### Admin Panel

Accessible via a hidden route in the navbar — not linked publicly.
