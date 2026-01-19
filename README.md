# Garment Costing PWA (HTML/CSS/JS only)

A **business-critical**, offline-ready garment costing Progressive Web App (PWA) built using **only**:
- HTML, CSS, JavaScript
- Local storage via **IndexedDB** (no server, no Node, no paid services)

---

## 🔗 Live Hosted Link (GitHub Pages)
**App Link:** https://wahidhasan-75.github.io/Garment_costing_calculation/

> If you don’t see the latest update, your browser may be using PWA cache.  
> Fix: DevTools → Application → Storage → **Clear site data**, then hard refresh.

---

## ✅ Features
- **Wizard-style costing flow** (step-by-step, factory-friendly)
- **Download/Print as PDF** from a saved costing detail (device print dialog → Save as PDF)
- **Modern mobile-first UI** (cards, smooth inputs, clean spacing)
- **Offline support** via Service Worker
- **Add to Home Screen** support (works best on HTTPS)
- **Photo upload**: camera or gallery
- **On-device image compression** before saving to IndexedDB
- **Hard-coded locked formulas** + **calcVersion** for audit
- **Read-only records** by default
- **Duplicate & Recalculate** to create a new audited version
- **Backup / Restore** data as JSON (includes images)

---

## 🧭 How to Use (Quick Workflow)
1. Click **New Costing**
2. Fill **Step 1: Basic Style Info**
   - Style Name / Number
   - Yarn Description
   - Photo (optional depending on build)
   - Gauge
   - Weight (grams)
3. Continue through each costing step using **Next / Previous**
4. Review the **Preview / Breakdown**
5. Save the record
6. Open any saved record to:
   - View breakdown
   - **Download PDF**
   - Duplicate & recalculate

---

## ▶ Run locally (VS Code)
**Important:** Service workers require a web server (not `file://`).

### Option A (Recommended): VS Code Live Server extension
1. Install extension: **Live Server** (Ritwick Dey)
2. Right-click `index.html` → **Open with Live Server**
3. Open the URL shown (example: `http://127.0.0.1:5500/`)

### Option B: Any static server
Use any static server (Apache/Nginx). No backend logic is required.

---

## 📱 Install as an App (iPhone / Android)

### iPhone (Safari)
1. Open the hosted link in **Safari**
2. Tap **Share**
3. Tap **Add to Home Screen**
4. Launch from the home screen icon

### Android (Chrome)
1. Open the hosted link in **Chrome**
2. Tap **⋮**
3. Tap **Add to Home screen**

---

## 🖼 Screenshots

Create this folder in the repo:
`docs/screenshots/`

Add screenshots with these names:
- `list.png` (Saved costings list)
- `step1.png` (Step 1 basic style info)
- `wizard.png` (Any wizard step)
- `detail.png` (Costing detail + breakdown)

Then the images will appear here:

### Saved costings list
![Saved costings](docs/screenshots/list.png)

### Step 1 (Basic Style Information)
![Step 1](docs/screenshots/step1.png)

### Wizard step example
![Wizard](docs/screenshots/wizard.png)

### Costing detail + breakdown
![Detail](docs/screenshots/detail.png)

---

## 🔒 Formula safety
Formula logic is in `app.js` → `computeCosts()` / `computeAll()` (depending on version).
- Blank optional inputs are treated as **0**
- Commission validated in **0–100%**
- Negative values blocked

If you change formulas:
- bump `CALC_VERSION` in `app.js`
- document the change for audit integrity

---

## 📁 Project structure
- `index.html` – UI shell
- `styles.css` – UI styles
- `db.js` – IndexedDB wrapper
- `app.js` – app logic, validations, compression, rendering
- `sw.js` – service worker offline cache
- `manifest.json` – PWA manifest
- `assets/icons/` – icons

---

## ⚠ Disclaimer
**Final costing should be reviewed before buyer submission.**

