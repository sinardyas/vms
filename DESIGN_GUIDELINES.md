# UI Design Guidelines

A reference for building consistent web UIs across Soechi internal projects. Derived from the GA Travel Ticket & Accommodation app (`peb_tenant/ga_dashboard.html`, `peb_tenant/ticket_accom_processing.html`).

Developers and AI agents should follow these patterns so new projects look and feel like part of the same family. When in doubt, copy an existing component's markup and adapt the content — don't reinvent.

---

## 1. Tech Stack & Setup

Every page is a self-contained HTML file using CDN dependencies (no build step).

```html
<!-- Tailwind CSS (utility-first styling, configured inline) -->
<script src="https://cdn.tailwindcss.com"></script>
<!-- Phosphor Icons (all UI iconography) -->
<script src="https://unpkg.com/@phosphor-icons/web"></script>
<!-- Inter font (the only typeface) -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<!-- SheetJS (only when Excel export is needed) -->
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script>
```

**Required Tailwind config** — declare it inline in a `<script>` before the page renders:

```html
<script>
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: { sans: ['Inter', 'sans-serif'] },
        colors: {
          primary: '#0071e3',        // Redisea Blue (brand action color)
          secondary: '#f4f5f7',
          success: '#28a745',
          warning: '#fff3cd',
          warningText: '#856404',
          sidebarActive: '#e6f7ff',
          sidebarText: '#595959',
        }
      }
    }
  }
</script>
```

**Page baseline:**

```html
<body class="text-slate-800">
```
```css
body { background-color: #f0f4f8; min-height: 100vh; }
```

- App background is always the soft blue-grey `#f0f4f8` (or `#f8fafc` for the inner work area).
- Default text color is `slate-800`.
- Reserve a `<style>` block only for things Tailwind utilities can't express cleanly: keyframe animations, custom scrollbars, and a few stateful component classes (stepper, tabs).

---

## 2. Color System

| Role | Value | Usage |
|------|-------|-------|
| **Primary / Brand** | `#0071e3` → `blue-600` | Primary buttons, active states, focus rings, links, accents |
| **Brand navy** | `#002d5a` / `#006494` | Table headers, top accent border, logo text |
| **App background** | `#f0f4f8` / `#f8fafc` | Page and work-area backgrounds |
| **Surface** | `white` | Cards, modals, headers, inputs |
| **Borders** | `gray-100` / `gray-200` / `slate-200` | Card and divider borders |
| **Success** | `green-600`, bg `green-50/100` | Confirm/approve/export actions, completed states |
| **Danger** | `red-600`, bg `red-50/100` | Reject/cancel/delete, errors, required `*` |
| **Warning / Notes** | `amber-600`, bg `amber-50`, border `amber-100` | Request notes, callouts |
| **Info accent** | `indigo-600`, bg `indigo-50` | Secondary categorization (e.g. accommodation vs ticket) |
| **Muted text** | `gray-400` / `gray-500` / `slate-400` | Labels, captions, placeholders, helper text |

**Semantic color pairing** — tinted surfaces use a consistent triple of `{color}-50` background, `{color}-100/200` border, `{color}-600/700/800` text/icon. Apply this for stat cards, badges, callouts, and icon chips.

Each functional domain gets a signature color: **ticket → blue**, **accommodation → indigo**, **success/approve → green**, **danger/cancel → red**, **notes → amber**.

---

## 3. Typography

- **Font:** Inter everywhere.
- **Page title (`h1`):** `text-2xl font-bold text-gray-900`
- **Card / section title (`h2`/`h3`):** `text-xl font-bold` for major cards; `text-lg font-bold` for modals.
- **Section eyebrow label (the dominant heading style inside cards):**
  `text-[10px] font-bold text-gray-400 uppercase tracking-widest` (or `text-xs ... tracking-wider`). Use this for "Trip Details", "Payment Details", "Requester", etc.
- **Field label:** `text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2` (or `text-xs font-semibold text-gray-600`).
- **Body / input text:** `text-sm`, with values often `font-semibold` / `font-bold text-gray-700/900`.
- **Helper / caption:** `text-[10px]`–`text-xs text-gray-400/500`, sometimes `italic`.
- **Big metrics:** `text-4xl font-extrabold` (stat counters), `text-2xl font-black tracking-tight` (totals).

Pattern: **tiny uppercase wide-tracked labels** paired with **bold readable values** is the signature of this design language. Use it liberally.

---

## 4. Layout

### Page shell
```html
<body class="text-slate-800">
  <div class="flex min-h-screen flex-col">
    <header>…</header>
    <main class="flex-1 flex flex-col min-w-0 w-full max-w-7xl mx-auto">…</main>
  </div>
</body>
```
- Content is centered with `max-w-7xl mx-auto` (dashboards) or `max-w-4xl mx-auto` (forms).
- Standard content padding: `p-6`.

### Top header (consistent across all pages)
```html
<header class="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-6 sticky top-0 z-20">
  <!-- Left: logo -->
  <img src="https://digital-sign.soechi.com/Content/Images/logo%20only.png" alt="Redisea Logo" class="h-8 w-auto">
  <!-- Center: live clock (hidden on mobile) -->
  <div id="header-clock" class="text-gray-600 font-medium text-sm"></div>
  <!-- Right: user profile + hover logout dropdown -->
</header>
```
- Fixed `h-16`, white, `sticky top-0 z-20`, bottom border.
- Profile block shows name (`text-sm font-semibold`) + role (`text-xs text-gray-500`) + avatar (`h-10 w-10 rounded-full`) + caret, with a `group-hover` logout dropdown.
- Avatars use `https://ui-avatars.com/api/?name=…&background=0D8ABC&color=fff` as fallback.

### Sidebar (for multi-step / detail pages)
```html
<aside class="w-80 border-r border-gray-200 bg-white flex flex-col h-full hidden md:flex overflow-y-auto">
```
- Fixed `w-80`, white, hidden below `md` (`@media (max-width:768px){ #sidebar{display:none} }`).
- Composed of stacked sections separated by `border-b border-gray-100`: entity summary → collapsible documents → stepper nav → primary action → status card pinned to bottom (`mt-auto`).

### Responsiveness
- Mobile-first: stack with `flex-col`, switch to `sm:flex-row` / grids at breakpoints.
- Common grids: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (stats), `grid grid-cols-2 gap-6` (form fields).
- Hide secondary chrome on small screens with `hidden md:flex`; provide a mobile header alternative.

---

## 5. Core Components

### Cards
The fundamental container. Two radius conventions coexist — pick one per page and stay consistent:
- **Dashboard style:** `bg-white rounded-xl shadow-sm border border-gray-200`
- **Form/processing style:** `bg-white p-6 rounded-2xl border border-gray-100 shadow-sm mb-6`

Feature card with **top accent border**: add `border-t-4 border-t-[#002d5a]`.
Card header band: `px-6 pt-6 pb-6 border-b border-gray-200 bg-gradient-to-r from-white to-blue-50/30`.

### Stat / counter cards
```html
<div class="bg-blue-50 border border-blue-200 rounded-xl p-6 shadow-sm flex flex-col justify-between group hover:shadow-md transition-all">
  <div class="flex items-center gap-2 mb-2">
    <div class="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
      <i class="ph ph-clock-countdown text-xl"></i>
    </div>
    <span class="text-blue-800 text-xs font-bold uppercase tracking-wider">Awaiting Process</span>
  </div>
  <span class="text-4xl font-extrabold text-blue-900 mt-1">0</span>
</div>
```
Swap the color family per metric (blue / amber / red / green). Icon sits in a rounded `w-8 h-8` chip; large `text-4xl font-extrabold` number anchors the card.

### Buttons

| Type | Classes |
|------|---------|
| **Primary** | `bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg shadow-blue-100 flex items-center gap-2` |
| **Success** | `bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg/xl shadow-md shadow-green-100` |
| **Danger (solid)** | `bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-100` |
| **Danger (outline)** | `border-2 border-red-500 text-red-500 hover:bg-red-50 font-bold rounded-xl` |
| **Secondary / neutral** | `border border-gray-300 shadow-sm text-gray-700 bg-white hover:bg-gray-50 font-medium rounded-lg` |
| **Subtle text / back** | `text-gray-400 hover:text-gray-600 font-bold` |

Conventions:
- Buttons are bold, pill-ish (`rounded-lg`/`rounded-xl`/`rounded-2xl`), with `transition-all`.
- Almost always pair a Phosphor icon with the label via `flex items-center gap-2`.
- Colored buttons get a matching tinted shadow (`shadow-{color}-100`).
- Focus ring on neutral buttons: `focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`.
- Paired modal footer buttons use `flex-1` (cancel) + `flex-[2]` (confirm) to weight the primary action.

### Status badges
```html
<span class="status-badge status-active">Active</span>
```
```css
.status-badge { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.status-active { background:#e6fffa; color:#047857; }
.status-draft  { background:#fff7ed; color:#c2410c; }
```
Small inline pills also appear as `bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide` (section tags, role chips).

### Forms & inputs
Two interchangeable input styles — keep one per form:
- `border border-gray-300 rounded-lg ... focus:ring-1 focus:ring-blue-500 focus:border-blue-500` (dashboard)
- `border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700 focus:border-blue-500 transition-colors` (forms)

Rules:
- Every field has a tiny uppercase label above it (see Typography).
- Read-only fields: `bg-gray-50 text-gray-500 cursor-not-allowed` + `readonly`.
- Required marker: `<span class="text-red-500">*</span>`.
- Textareas: `rounded-xl p-4 h-24 resize-none`.
- Search inputs: relative wrapper with an absolutely-positioned `ph-magnifying-glass` icon and `pl-10` padding.
- Currency inputs: relative wrapper with a `Rp`/`$` prefix span (`left-4`) and a currency-code suffix span (`right-4`).

### Tables
```html
<div class="overflow-x-auto border border-gray-200 rounded-lg">
  <table class="w-full text-left border-collapse">
    <thead>
      <tr class="bg-[#002d5a] text-white text-xs uppercase tracking-wider">
        <th class="p-4 font-medium">Request No</th> …
      </tr>
    </thead>
    <tbody class="bg-white divide-y divide-gray-100">…</tbody>
  </table>
</div>
```
- Header is **navy `#002d5a`, white, uppercase, tracked**; cells `p-4`.
- Rows separated by `divide-y divide-gray-100`.
- Wrap in `overflow-x-auto` + rounded bordered container.
- Action column right-aligned (`text-right`).
- Loading/empty rows: `<td colspan>` with `p-8 text-center text-gray-400`.

### Pagination
```html
<div class="flex items-center justify-between px-6 py-4 border-t border-gray-200">
  <div class="text-sm text-gray-500">Showing <span class="font-medium">1</span> to … of … results</div>
  <div class="flex items-center gap-2">
    <button class="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
    <button …>Next</button>
  </div>
</div>
```

### Filter bar
Collapsible region toggled by a "Filters" button that carries a small red dot indicator (`-top-1 -right-1 h-3 w-3 rounded-full bg-red-500`) when filters are active. Date-range, department, status etc. live in a `hidden mt-4 pt-4 border-t` section with a `Reset` button.

---

## 6. Modals & Overlays

### Centered dialog
```html
<div class="fixed inset-0 z-50 hidden items-center justify-center bg-black bg-opacity-50">
  <div class="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6"> … </div>
</div>
```
- Backdrop: `bg-black bg-opacity-50` (or richer `bg-slate-900/60 backdrop-blur-sm` for premium modals).
- Panel: white, `rounded-xl`/`rounded-2xl`, `shadow-lg`/`shadow-2xl`, sized `max-w-sm`/`md`/`lg`.
- Animated panels start `scale-95 opacity-0` and transition in.
- Header pattern: tinted icon chip + title + uppercase eyebrow subtitle + `ph-x` close button.
- Footer: cancel + confirm buttons weighted `flex-1` / `flex-[2]`.
- Layer z-index by role: dialogs `z-50`, drawers/log `z-[60]`, preview/confirm `z-[70]`, loading `z-[100]`.

### Slide-over drawer (e.g. activity log)
Right-anchored `max-w-md` panel that slides in via `translate-x-full → translate-x-0`, `duration-300`. Used for timelines, detail panels, history.

### Timeline (inside drawer)
Vertical line via `before:` pseudo-element:
```html
<div class="relative pl-6 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200"> … </div>
```

### Loading overlay
Full-screen white veil + spinner + status text:
```html
<div id="loading-overlay" class="fixed inset-0 bg-white bg-opacity-80 z-[100] flex items-center justify-center flex-col hidden">
  <div class="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
  <div class="text-blue-600 font-bold text-sm tracking-wide">Loading...</div>
</div>
```
Spinner = bordered circle with a single colored top border + `animate-spin`.

### Empty states
Centered: muted circular icon chip (`w-16 h-16 bg-slate-100 rounded-full`) + bold title + muted explanatory line. Use for "no data found".

---

## 7. Specialized Patterns

### File upload zone
```html
<div class="border-2 border-dashed border-blue-50 rounded-2xl p-8 flex flex-col items-center justify-center bg-blue-50/30 hover:bg-blue-50/50 hover:border-blue-200 transition-all cursor-pointer group">
  <div class="w-12 h-12 bg-white rounded-full flex items-center justify-center text-blue-500 shadow-sm mb-3 group-hover:scale-110 transition-transform">
    <i class="ph ph-cloud-arrow-up text-2xl"></i>
  </div>
  <div class="text-sm font-bold text-blue-600">Upload Files <span class="text-gray-400 font-medium ml-1">or drag and drop</span></div>
  <div class="text-[10px] text-gray-400 mt-2 font-bold uppercase tracking-widest">PDF, JPG, PNG up to 1.5MB</div>
</div>
```
Dashed blue zone, floating icon chip that scales on hover, bold prompt + uppercase constraints caption. Hidden `<input type="file">` triggered by clicking the zone; selected files render in a `<ul>` below.

### Custom select / searchable dropdown
A hidden `<input>` holds the value; a styled trigger div shows the selection with a caret; the dropdown contains a search box (with magnifier icon) over a scrollable `max-h-60 overflow-y-auto` list. Use this instead of native `<select>` when options need searching/avatars.

### Stepper (multi-step forms)
Sidebar nav of `.step-item`s with numbered circles. States: default, `.active` (blue ring `box-shadow: 0 0 0 4px rgba(59,130,246,.1)`, blue number, navy bold label), `.completed` (green number on `#dcfce7`). See the `<style>` block in `ticket_accom_processing.html` for the full CSS.

### Tabs
```html
<div class="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
  <button class="px-6 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2">…</button>
</div>
```
Segmented control on a `bg-gray-100` track. Active tab uses `.tab-active` (`border-bottom: 2px solid #3b82f6; color:#3b82f6; font-weight:600`). Tabs can show a `ph-check-circle text-green-500` once their section is complete.

### Callout boxes
Tinted info blocks: `bg-amber-50 border border-amber-100 rounded-xl p-4` (notes), `bg-red-50 border border-red-100 rounded-2xl p-5` (revision/error), `bg-blue-50 border border-blue-100 rounded-2xl p-4` (info). Lead with a bold icon + uppercase tracked eyebrow, then the message.

### Credit-card display
A dark `bg-slate-900` + `bg-gradient-to-br from-slate-800 to-slate-950` panel mimicking a physical card: uppercase micro-labels (`text-[9px] text-slate-400 tracking-widest`) over mono card number (`font-mono tracking-[0.2em]`), brand logo slot, blue-accented limit. Use for any sensitive/credential display.

---

## 8. Iconography

- **Library:** Phosphor Icons only. `ph ph-{name}` for regular, `ph-bold ph-{name}` for bold, `ph-fill ph-{name}` for filled.
- Icons almost always accompany text in buttons, labels, and headers (`flex items-center gap-2`).
- Decorative icons sit in rounded chips: `w-8 h-8`/`w-10 h-10`/`w-12 h-12 rounded-lg/full` with a tinted bg matching the semantic color.
- Common icons: `ph-magnifying-glass` (search), `ph-caret-down/right/left` (navigation), `ph-x` (close), `ph-check-circle` (success/confirm), `ph-warning-circle` (alert), `ph-cloud-arrow-up` (upload), `ph-file-xls` (export), `ph-download-simple`, `ph-clock-counter-clockwise` (history).

---

## 9. Motion & Interaction

- Default transition on interactive elements: `transition-all` / `transition-colors` (≈200ms).
- Hover affordances: `hover:shadow-md` (cards), `hover:bg-*-50` (rows/buttons), `group-hover:scale-110` (upload icons).
- Spinners: bordered circle, single colored top border, `animate-spin`; use `animate-spin-slow` (8s) for ambient/processing indicators.
- Disabled state: `disabled:opacity-50 disabled:cursor-not-allowed`.
- Keyframes (`spin`, `spin-slow`) live in the page `<style>` block.

---

## 10. Spacing & Shape Cheat-Sheet

| Token | Convention |
|-------|-----------|
| **Card radius** | `rounded-xl` (dashboard) / `rounded-2xl` (forms & modals) |
| **Button/input radius** | `rounded-lg` / `rounded-xl` |
| **Badge/pill radius** | `rounded-full` or `rounded` (4px) |
| **Card padding** | `p-6` |
| **Field gaps** | `gap-4` / `gap-6` |
| **Section spacing** | `mb-6` between cards, `space-y-4` within |
| **Shadows** | `shadow-sm` (resting) → `shadow-md`/`shadow-lg` (raised/hover) → `shadow-2xl` (modals); colored buttons add `shadow-{color}-100` |
| **Icon chips** | `w-8/10/12` square, `rounded-lg`/`rounded-full`, tinted bg |

---

## 11. Checklist for a New Page

1. Start from the HTML head boilerplate (Tailwind + config, Phosphor, Inter) and `body` baseline.
2. Add the standard sticky white header with logo, clock, and profile dropdown.
3. Constrain content with `max-w-7xl`/`max-w-4xl mx-auto` and `p-6`.
4. Build content from white cards (`rounded-xl`/`2xl`, `shadow-sm`, gray border); use the navy top-accent for the primary card.
5. Use tiny uppercase tracked labels + bold values throughout.
6. Apply semantic colors consistently (blue=primary, green=success, red=danger, amber=notes, indigo=secondary).
7. Pair every button/label with a Phosphor icon.
8. Include loading overlay, empty states, and disabled states.
9. Make it responsive: stack on mobile, hide non-essential chrome below `md`.
10. Match an existing component's markup rather than inventing a new variant.
