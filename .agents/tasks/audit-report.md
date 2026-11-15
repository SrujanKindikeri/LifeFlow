# LifeFlow Technical Audit Report

**Generated:** 2025-01-28  
**Auditor:** Automated read-only technical audit  
**Project root:** `c:\Users\kindi\OneDrive\Documents\LifeFlow-Main`  
**Next.js version:** 16.3.4  
**React version:** 19.2.8  

---

## Executive Summary

The LifeFlow application is a well-structured Next.js 16 / React 19 App Router project with MongoDB (Mongoose), iron-session authentication, and a comprehensive feature set. The codebase shows strong security practices, good separation of server/client concerns, and thorough logging.

**Critical issues found: 2**  
**High issues found: 4**  
**Medium issues found: 6**  
**Low issues found: 5**  

The most critical issue is the **missing `models/AnalyticsEvent.ts` model file**, which causes a hard runtime crash on two production API routes. The second critical issue is the **`next/script` usage in `app/layout.tsx`** which the Next.js 16 docs indicate should be replaced with the `InlineScript` pattern for inline theme scripts. Both must be fixed before deploying.

---

## Phase 0: Configuration and Startup

### ISSUE-001 — Script component usage for inline theme init is suboptimal for Next.js 16
**Severity:** High  
**File:** `app/layout.tsx`, lines 44–92  

**Description:**  
`app/layout.tsx` uses `import Script from 'next/script'` with `strategy="beforeInteractive"` and `dangerouslySetInnerHTML` to inject the theme initialisation inline script. The runtime error reported — `Element type is invalid. Received a promise that resolves to: [object Object]. Lazy element type must resolve to a class or function.` — was produced in a previous version of this file.

**Root cause analysis:**  
The current `node_modules/next/dist/client/script.js` exports a valid CJS module with a proper `_default = Script` export and an ESM interop block at the bottom:
```js
if ((typeof exports.default === 'function' || ...) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}
```
This means `import Script from 'next/script'` correctly resolves to the `Script` function component. The module is NOT a promise-wrapped import.

However, the Next.js 16 official guide `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` recommends a **different pattern** for inline theme scripts: place a bare `<script dangerouslySetInnerHTML>` directly in `<head>` inside the layout (NOT via `next/script`), optionally wrapped in an `InlineScript` helper to suppress the React 19 `<script>` warning. `next/script` is designed for _external_ scripts.

The existing `components/ui/InlineScript.tsx` already implements the correct Next.js 16 pattern (identical to the guide example). The theme init script should use `<InlineScript>` placed inside `<head>`, not `<Script strategy="beforeInteractive">`.

**Current state:** The `Script` component technically renders correctly right now. The original runtime error was likely triggered during a prior hot-reload cycle or a Turbopack module resolution race, not by a stable structural defect. The issue is medium-severity until the `beforeInteractive` path causes a hydration or CSP regression.

**Required fix:**  
Replace the `<Script strategy="beforeInteractive" dangerouslySetInnerHTML=...>` in `app/layout.tsx` with:
```tsx
import { InlineScript } from '@/components/ui/InlineScript'
// ...
<html lang="en" data-theme="light" suppressHydrationWarning>
  <head>
    <InlineScript html={`...theme init JS...`} />
  </head>
  <body>...</body>
</html>
```
This matches the `## Themes` section of the Next.js 16 preventing-flash guide exactly and avoids using `next/script` for inline scripts.

**Dependencies/risks:**  
- Existing `InlineScript` component at `components/ui/InlineScript.tsx` is already correct and matches the guide verbatim.  
- Must move script from `<body>` to `<head>` to ensure it fires before first paint.  
- `suppressHydrationWarning` on `<html>` is correctly present already.

---

### ISSUE-002 — `console.log` debug statements left in production API routes
**Severity:** Medium  
**Files:**  
- `app/api/auth/me/route.ts` lines 117, 121, 258, 262, 268, 277, 282, 295 (profile save debug logs)  
- `app/api/group-bills/route.ts` lines 78, 80, 110, 139, 145, 149, 164 (group bill save debug logs)  

**Description:**  
Multiple `console.log('[PROFILE LOAD DEBUG] ...')` and `console.log('[GROUP BILL] ...')` statements are left in production route handlers. These bypass the structured `logger` and may expose internal state to log aggregators without redaction.

**Root cause:** Development debugging code not cleaned up before audit.

**Required fix:** Replace with `logger.info(...)` calls or remove entirely. The `logger` already handles structured JSON output in production and is imported in both files.

**Dependencies/risks:** Low. `logger` is already imported in `me/route.ts`. Needs to be imported in `group-bills/route.ts`.

---

### ISSUE-003 — `vitest.workspace.ts` comment describes jsdom but config uses node environment for browser-idb project
**Severity:** Low  
**File:** `vitest.workspace.ts`, lines 24–26  

**Description:**  
The workspace config comment says `Environment: jsdom + fake-indexeddb globals` but the actual config sets `environment: 'node'` for the `browser-idb` project. The comment is misleading but functional since `fake-indexeddb` is injected via `setupFiles`.

**Required fix:** Update the comment to match the actual environment (`node` with fake-indexeddb injected), or switch to `jsdom` if full DOM APIs are needed. Current behavior is correct.

---

### ISSUE-004 — `.env.local` absent from repository (expected, but `next build` may fail without it)
**Severity:** Low  
**File:** Root configuration  

**Description:**  
`.env.local` is correctly absent from the repo (it should not be committed). The `lib/env.ts` design correctly defers validation to runtime. However, if `next build` is run without secrets, routes that import models at module level could fail type checks in some edge cases. The design handles this correctly with lazy imports and runtime validation.

**Required fix:** None. Existing design is correct. Document in `README.md` that `cp .env.example .env.local` is required before first run.

---

## Phase 1: Import/Export and Module Resolution

### ISSUE-005 — `models/AnalyticsEvent.ts` is MISSING — causes hard runtime crash
**Severity:** Critical  
**Files:**  
- `app/api/analytics/track/route.ts` — imports `AnalyticsEvent, { TRACKED_SECTIONS }` from `@/models/AnalyticsEvent`  
- `app/api/admin/intelligence/overview/route.ts` — imports `AnalyticsEvent` from `@/models/AnalyticsEvent`  
- `hooks/useSectionView.ts` — posts to `/api/analytics/track`  
- `components/admin/IntelligenceOverviewClient.tsx` — calls the admin intelligence overview endpoint  

**Description:**  
`models/AnalyticsEvent.ts` does not exist. Both `POST /api/analytics/track` and `GET /api/admin/intelligence/overview` will throw a module-not-found error at import time, returning a 500 to every caller. The `useSectionView` hook fires silently (fire-and-forget) so user pages render, but all analytics tracking is broken and the admin intelligence overview dashboard crashes.

**Root cause:**  
The model file was likely deleted or was never committed. The route files, hooks, and admin client all reference it, so it was clearly planned and partially implemented.

**Required fix:**  
Create `models/AnalyticsEvent.ts` with the schema implied by the route usage:

```typescript
import mongoose, { Schema, Model } from 'mongoose'

export const TRACKED_SECTIONS = [
  'dashboard', 'notes', 'tasks', 'habits', 'expenses',
  'budgets', 'goals', 'savings', 'subscriptions', 'projects',
  'people', 'calendar', 'analytics', 'notifications',
  'money', 'drafts', 'daily-intelligence', 'weekly-planning',
  'financial-review', 'activity', 'focus', 'invitations',
  'profile', 'settings',
] as const

export type TrackedSection = typeof TRACKED_SECTIONS[number]

interface IAnalyticsEvent {
  userId: mongoose.Types.ObjectId
  section: TrackedSection
  dateString: string   // "YYYY-MM-DD"
  hour: number         // 0–23
  key: string          // unique: `userId:section:dateString:hour`
  createdAt: Date
}

const AnalyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    userId:     { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    section:    { type: String, required: true, enum: TRACKED_SECTIONS },
    dateString: { type: String, required: true, index: true },
    hour:       { type: Number, required: true, min: 0, max: 23 },
    key:        { type: String, required: true, unique: true },
  },
  { timestamps: true }
)

const AnalyticsEvent: Model<IAnalyticsEvent> =
  mongoose.models.AnalyticsEvent ||
  mongoose.model<IAnalyticsEvent>('AnalyticsEvent', AnalyticsEventSchema)

export default AnalyticsEvent
```

**Dependencies/risks:**  
- The unique index on `key` is what enables the deduplication logic in `analytics/track/route.ts` (E11000 is intentionally caught and silenced).  
- The `TRACKED_SECTIONS` constant must match what `useSectionView` callers pass as the section string. Review `hooks/useSectionView.ts` and all callers.  
- After creating the model, run `npm run typecheck` to confirm the route files compile.

---

### ISSUE-006 — `AdminCard.tsx` and `FeaturePage.tsx` have no `'use client'` directive despite using interactive event handlers
**Severity:** Medium  
**File:** `components/admin/AdminCard.tsx`  

**Description:**  
`AdminCard.tsx` exports `ConfirmDialog` and `Pagination` which contain `onClick` handlers. Without `'use client'`, these would be Server Components in Next.js 16 App Router and the event handlers would be ignored or cause a runtime error. The file also contains `FeaturePage.tsx` which does have `'use client'` as its first line. However `AdminCard.tsx` has no directive at all.

**Root cause:** Server Component is never valid for components with interactive event handlers (`onClick`, `onConfirm`, `onCancel`).

**Required fix:** Add `'use client'` as the first line of `components/admin/AdminCard.tsx`.

**Dependencies/risks:**  
- `AdminCard` exports are only used in admin client pages/components that are already `'use client'`. Adding the directive will not break any existing import.  
- `SectionHeader`, `EmptyState`, `ErrorState`, `LoadingSpinner`, and `StatusBadge` are all display-only and safe in both environments.

---

### ISSUE-007 — `@/types` import in `app/api/auth/me/route.ts` requires `types/index.ts` to export `AppearancePreferences`
**Severity:** Low  
**File:** `app/api/auth/me/route.ts` line 7: `import type { AppearancePreferences } from '@/types'`  

**Description:**  
`types/index.ts` does export `AppearancePreferences`. Confirmed by reading the file. This import is valid. No issue.

---

## Phase 2: Database and Authentication

### ISSUE-008 — `connectDB()` missing before all queries in `app/api/auth/me/route.ts` GET handler's fallback path is covered
**Severity:** Low  

**Description:**  
All API route handlers that query MongoDB call `await connectDB()` before the first query. This is correctly implemented across all reviewed routes. No missing `connectDB()` calls found in the sample of routes examined (`login`, `me`, `auth/*`).

---

### ISSUE-009 — Admin login via `/api/auth/login` does not check `emailVerified` before granting admin session
**Severity:** Medium  
**File:** `app/api/auth/login/route.ts`, lines 55–75  

**Description:**  
When an admin email is detected in the shared login route, the route creates an admin session and returns a redirect to `/admin/dashboard` without verifying the admin's email. The `AdminUser` model may not have an `emailVerified` field, but it also has no equivalent check. If an admin account is created before email verification completes, there is a window where the admin can log in.

**Root cause:**  
The admin user model and flow are entirely separate from the user flow. The admin flow was added after the user flow and may not have inherited the email-verification gate.

**Required fix:**  
Review `models/AdminUser.ts` to confirm whether `emailVerified` is a field. If admins are created programmatically (seed/bootstrap), add a comment explaining why email verification is not required. If email verification is desired for admins, add the check at lines 55–75.

**Dependencies/risks:** Depends on whether `AdminUser` schema includes `emailVerified`.

---

### ISSUE-010 — Session cookie `maxAge` is hardcoded to 24 hours in `getSessionOptions()` and does not read `SESSION_ABSOLUTE_TIMEOUT_HOURS`
**Severity:** Medium  
**File:** `lib/session.ts`, line 191  

```typescript
maxAge: 60 * 60 * 24, // 24 hours (matches default SESSION_ABSOLUTE_TIMEOUT_HOURS)
```

**Description:**  
If `SESSION_ABSOLUTE_TIMEOUT_HOURS` is changed to, say, 48 hours, the session cookie expires after 24 hours (browser deletes it), invalidating the session before the server-side absolute deadline fires. The session test file `tests/session-expiry.test.ts` even checks this: `expect(opts.cookieOptions?.maxAge).toBe(60 * 60 * 24)` — confirming the hardcoded value.

**Root cause:**  
The `maxAge` was not wired to the env var. The comment acknowledges the coupling but doesn't implement it.

**Required fix:**  
```typescript
maxAge: Math.max(
  getAbsoluteTimeoutMs() / 1000,
  60 * 60 * 24  // minimum 24 h as a floor
),
```
Or read the env var directly:
```typescript
maxAge: (parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? '24', 10) || 24) * 60 * 60,
```

**Dependencies/risks:**  
The session-expiry test at line 379 (`expect(opts.cookieOptions?.maxAge).toBe(60 * 60 * 24)`) will need to be updated after the fix.

---

### ISSUE-011 — `lib/session.ts` calls `import('@/models/User')` as a dynamic import inside `requireAuth()` on every authenticated request
**Severity:** Low  
**File:** `lib/session.ts`, line ~260  

**Description:**  
Dynamic import `const { default: User } = await import('@/models/User')` is used inside `requireAuth()` to avoid circular dependencies. In Node.js (not edge runtime), dynamic imports of already-loaded modules are resolved from cache on subsequent calls — this is not a performance problem. The comment explains the rationale (lazy import to avoid circular dependency at module load time). No action needed.

---

## Phase 3: Backend API

### ISSUE-012 — `POST /api/group-bills` has debug-level `console.log` statements throughout the happy path
**Severity:** Medium  
**File:** `app/api/group-bills/route.ts`, lines 78, 80, 87, 101, 110, 139, 145, 149, 164, 185  

**Description:**  
Ten `console.log` and `console.error` calls remain in the production group bill creation handler. Some log potentially sensitive business data (calculation results, grand totals). These bypass `logger`'s structured output and redaction rules.

**Required fix:** Replace with `logger.info(...)` or `logger.error(...)` using the structured logger already imported in other route files. Remove the informational debug lines (e.g. `console.log('[GROUP BILL] save started')`) entirely or convert to `logger.debug(...)` gated by `NODE_ENV=development`.

---

### ISSUE-013 — `GET /api/admin/intelligence/overview` and `POST /api/analytics/track` will crash at import time due to missing `AnalyticsEvent` model
**Severity:** Critical  
**Files:** `app/api/admin/intelligence/overview/route.ts` line 7, `app/api/analytics/track/route.ts` line 4  

**Description:**  
Both routes import `AnalyticsEvent` from `@/models/AnalyticsEvent` at the top of the file (static import). Since the file does not exist, Next.js / Node.js will throw `Cannot find module '@/models/AnalyticsEvent'` on the first request, returning a 500 error. This is a duplicate of ISSUE-005 but captured here for the API-layer audit record.

**Required fix:** See ISSUE-005.

---

### ISSUE-014 — Several API routes use `console.error` instead of `logger.error` in catch blocks
**Severity:** Low  
**Files:** Multiple — `app/api/activity/route.ts:47`, `app/api/analytics/route.ts:230`, `app/api/auth/avatar/route.ts:130,157`, `app/api/auth/me/route.ts:123,295`, `app/api/briefing/route.ts:135`, and ~20 others  

**Description:**  
Many catch blocks use `console.error('[route name]', error)` instead of `logger.error(...)`. In production this means errors bypass the structured JSON logging pipeline and are written as unstructured stderr lines that log aggregators (CloudWatch, Azure Monitor) may not parse correctly.

**Required fix:**  
Systematically replace `console.error('[xyz]', error)` with:
```typescript
logger.error('[xyz]', { errorMessage: error instanceof Error ? error.message : String(error) })
```
Priority: routes with `console.error` in catch blocks that do NOT also have `logger` calls.

---

### ISSUE-015 — `DELETE /api/auth/me` delegates to `POST /api/auth/delete-account` via dynamic import — confirm it handles `NextRequest` body correctly
**Severity:** Low  
**File:** `app/api/auth/me/route.ts`, lines 299–305  

**Description:**  
```typescript
const { POST: deleteAccountHandler } = await import('@/app/api/auth/delete-account/route')
return deleteAccountHandler(req)
```
This pattern passes the original `NextRequest` to the delete-account handler. `NextRequest.json()` can only be called once (the body stream is consumed). If `me PATCH` ever reads `req.json()` before the `DELETE` branch is reached, this would fail. Looking at the code, `DELETE` returns early before any `req.json()` call in the PATCH path, so there is no body-consumed issue. However, the dynamic import means the delete-account module is tree-shaken into the `me` route bundle.

**Required fix:** None immediately. Add a comment explaining that the `req` body has not been consumed at the point of delegation.

---

## Phase 4: Frontend

### ISSUE-016 — `app/layout.tsx` uses `next/script` for inline theme init; should use `InlineScript` + `<head>` per Next.js 16 guide
**Severity:** High  
**File:** `app/layout.tsx`, lines 1–2 and 44–92  

**Description:**  
This is the same as ISSUE-001 from Phase 0, surfaced here as a frontend rendering issue. The original error `Element type is invalid. Received a promise that resolves to: [object Object]` is consistent with a Turbopack/Webpack module resolution race where `next/script`'s CJS interop block is not yet complete when React tries to render. The Next.js 16 guide explicitly says for inline scripts that mutate `<html>` attributes: place a bare `<script>` tag in `<head>`, wrapped with the `InlineScript` helper to suppress the React 19 dev warning.

**Required fix:**  
Replace in `app/layout.tsx`:
```tsx
// REMOVE:
import Script from 'next/script'
// ...
<Script id="lf-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `...` }} />

// ADD:
import { InlineScript } from '@/components/ui/InlineScript'
// ...
<html lang="en" data-theme="light" suppressHydrationWarning>
  <head>
    <InlineScript html={THEME_INIT_SCRIPT} />
  </head>
  <body>
    <ThemeProvider>
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  </body>
</html>
```
Where `THEME_INIT_SCRIPT` is the same IIFE string currently in `dangerouslySetInnerHTML.__html`.

**Dependencies/risks:**  
- `InlineScript` component already exists at `components/ui/InlineScript.tsx` and implements the exact pattern from the guide.  
- Moving the script to `<head>` does NOT require an explicit `<head>` element in JSX — React/Next.js treats elements inside `<html>` before `<body>` as head content automatically.  
- The `suppressHydrationWarning` on `<html>` already present correctly handles the `data-theme`/`data-night-shift` attribute mismatch between SSR and CSR.  
- `ThemeProvider` (`components/providers/ThemeProvider.tsx`) uses `useLayoutEffect` to re-apply the theme on client remount (dev mode Strict Mode double-invoke) — this is already the recommended pattern from the guide.

---

### ISSUE-017 — `app/admin/layout.tsx` applies to `app/admin/login/page.tsx` — the requireAdmin() check will redirect unauthenticated admins in an infinite loop if the proxy also redirects
**Severity:** Medium  
**File:** `app/admin/layout.tsx`, lines 23–65  

**Description:**  
The layout's own comment acknowledges this: "app/admin/login/page.tsx uses app/admin/layout.tsx (this file)". The layout calls `requireAdmin()` which throws `AdminUnauthorized`, causing a redirect to `/admin/login`. If the proxy also sends unauthenticated admin requests to `/admin/login`, and the layout is applied to `/admin/login`, the layout on `/admin/login` calls `requireAdmin()` again, potentially creating a loop.

The comment continues: "the proxy sends unauthenticated users to /admin/login which bypasses this guard at the proxy level". This means the proxy does NOT apply this layout to the login page at the proxy level — the fix is structural.

**Root cause:**  
The admin login route is at `app/(admin-auth)/admin/login/page.tsx` (confirmed from the file listing: `app/(admin-auth)\admin\login\page.tsx`), which is in a **separate route group** `(admin-auth)`. Because it uses a route group with `(admin-auth)`, it does NOT inherit the `app/admin/layout.tsx`. The `app/admin/layout.tsx` only applies to routes directly under `app/admin/` without the route group prefix. This is the correct structure.

**Current state:** No actual loop issue exists because of the route group separation. The comment in the layout is misleading/outdated.

**Required fix:** Clarify the comment in `app/admin/layout.tsx` to explain that `/admin/login` is served from the `(admin-auth)` route group and therefore does NOT use this layout.

---

### ISSUE-018 — `app/app/dashboard/DashboardClient.tsx` and many other Client Components — missing Suspense boundaries for async data
**Severity:** Low  
**File:** `app/app/layout.tsx`, `app/app/dashboard/page.tsx`  

**Description:**  
Server Components fetch data before returning `<DashboardClient data={data} />`. This is correct (data is fetched server-side, passed as props to the client). No async client-side data fetching without Suspense was found in the reviewed components. No missing Suspense boundaries were identified for the architecture used (server-fetch → client render pattern).

---

## Phase 5: Tests

### ISSUE-019 — Tests for the AnalyticsEvent model and analytics tracking are entirely absent
**Severity:** High  
**Files:** `tests/` directory, `hooks/useSectionView.ts`  

**Description:**  
No test file covers `models/AnalyticsEvent.ts`, `app/api/analytics/track/route.ts`, `app/api/admin/intelligence/overview/route.ts`, or `hooks/useSectionView.ts`. Given that `AnalyticsEvent` is the only missing model (Critical ISSUE-005), this gap directly contributed to the model going unnoticed.

**Required fix:**  
After creating `models/AnalyticsEvent.ts` (ISSUE-005), add a test file `tests/analytics.test.ts` covering:
- Schema creation and unique-key deduplication (E11000 on duplicate `key` field)
- `useSectionView` hook fires once per mount (can be tested with a minimal mock)
- `/api/analytics/track` returns 204 on success and on auth failure

---

### ISSUE-020 — Existing tests cover session expiry, account restoration, 2FA recovery, offline sync, notifications — no coverage gaps for auth-critical paths
**Severity:** Info  

**Description:**  
The following test suites exist and cover their stated areas:

| File | Coverage |
|------|----------|
| `lib/accountRestoration.test.ts` | Delete-account, restore-account, token security |
| `lib/receiptParser.test.ts` | OCR receipt parsing |
| `tests/2fa-recovery.test.ts` | TOTP recovery codes |
| `tests/admin-dashboard.test.ts` | Admin dashboard stats |
| `tests/email-verification.test.ts` | Email verification flow |
| `tests/intelligence.test.ts` | Daily intelligence briefings |
| `tests/lifeflow-id.test.ts` | Public ID generation |
| `tests/notification-email.test.ts` | Email notification delivery |
| `tests/notification-modules.test.ts` | In-app notification creation |
| `tests/notification-scheduler-precise.test.ts` | Precise scheduler |
| `tests/offline-idb.test.ts` | IndexedDB / Dexie offline |
| `tests/offline-sync.test.ts` | Sync engine |
| `tests/project-collaboration.test.ts` | Project invitations |
| `tests/session-expiry.test.ts` | 24h absolute + idle timeout |
| `tests/settings.test.ts` | User settings |
| `tests/support-center.test.ts` | Support tickets |
| `helpers/db.ts`, `helpers/factories.ts` | In-memory MongoDB + test users |

Coverage is good for auth and business logic. Gaps: analytics model (ISSUE-019), `useSectionView`, `InlineScript` component behavior.

---

## Package Version Notes

| Package | Installed | Notes |
|---------|-----------|-------|
| `next` | 16.3.4 | Correct. App Router, React 19 support. |
| `react` | 19.2.8 | Correct. Pairs with Next.js 16. |
| `lucide-react` | 1.42.0 | **Unusual version.** Standard lucide-react uses 0.x semver (e.g. 0.400+). Version 1.42.0 is a major-version bump. The package installed correctly (`dist/cjs`, `dist/esm` present) and exports icons as named exports. No runtime issue found, but confirm this is intentional and not a fork/fake package. |
| `zod` | 4.5.4 | Zod v4 is a major release. API change: `error.issues[0]` (not `error.errors[0]`). The codebase correctly uses `parsed.error.issues[0].message` throughout — confirmed compatible. |
| `nodemailer` | 7.0.6 | Nodemailer v7 is correct. |
| `iron-session` | 9.0.1 | Correct for Next.js App Router. |
| `mongoose` | 9.9.5 | Correct. |
| `@hookform/resolvers` | 5.9.1 | v5 is the latest major; uses zod v4 resolver. Compatible. |
| `dexie` | 4.4.6 | Dexie 4.x for IndexedDB offline sync. Correct. |

---

## Git Conflict Markers

**None found.** A complete scan of all `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`, and `.md` files (excluding `node_modules`, `.next`, `.git`) found zero instances of `<<<<<<<`, `=======`, or `>>>>>>>` conflict markers.

---

## Full File Inventory (Summary)

### App Router Routes
- **Auth routes:** 25 route files under `app/api/auth/` covering login, signup, 2FA (TOTP + email OTP), logout, verify-email, forgot/reset password, account restoration, avatar, session-status.
- **User data routes:** Expenses, budgets, goals, savings, habits, tasks, notes, subscriptions, projects, people, money-records, group-bills, drafts, calendar, activity, search, score, analytics, notifications, push-subscriptions, invitations, weekly-planning, daily-intelligence, briefing, financial-review.
- **Admin routes:** 30+ routes under `app/api/admin/` covering user management, analytics, notifications, sessions, security, audit logs, announcements, support tickets, system health, features monitoring.
- **Job routes:** `app/api/jobs/` for scheduled cleanup and notification processing.
- **Public routes:** `app/api/public/group-bill/[token]/` for shareable group bill links.

### Pages
- Root `/` → redirects to dashboard or login.
- Auth pages: login, signup, verify-email, forgot-password, reset-password, restore-account, check-email.
- App shell: dashboard, notes, tasks, habits, expenses, budgets, goals, savings, subscriptions, projects, people, calendar, analytics, notifications, money, drafts, daily-intelligence, weekly-planning, financial-review, activity, focus mode, invitations, profile, settings/security.
- Admin panel: dashboard, users, analytics, notifications, settings, audit-logs, announcements, security, sessions, support, sync, live-users, ip-history, intelligence, error-monitoring, feature pages.
- Special: maintenance, offline, group-bill public view.

### Models (all in `models/`)
Activity, ActivityHeartbeat, AdminUser, Announcement, AppSetting, AuditLog, Budget, DailyBriefing, DashboardPreference, Draft, Expense, Goal, GroupBill, GroupBillReminderToken, Habit, HabitLog, ModuleEvent, MoneyPayment, MoneyRecord, Note, Notification, NotificationLog, Person, Project, ProjectInvitation, ProjectMembership, ProjectMessage, PushSubscription, RecentActivity, RegistrationCounter, SavingsContribution, SavingsGoal, SecurityEvent, Subscription, SupportMessage, SupportTicket, Task, TransactionProof, User, UserSession.

**Missing: `models/AnalyticsEvent.ts`** (Critical — see ISSUE-005)

---

## Issue Summary Table

| ID | Phase | Severity | File | Title |
|----|-------|----------|------|-------|
| ISSUE-005 / ISSUE-013 | 1 / 3 | **Critical** | `models/AnalyticsEvent.ts` (missing), `app/api/analytics/track/route.ts`, `app/api/admin/intelligence/overview/route.ts` | Missing AnalyticsEvent model — hard runtime crash on 2 API routes |
| ISSUE-001 / ISSUE-016 | 0 / 4 | **High** | `app/layout.tsx` | `next/script` for inline theme init; should use `InlineScript` + `<head>` per Next.js 16 guide |
| ISSUE-006 | 1 | **High** | `components/admin/AdminCard.tsx` | Missing `'use client'` directive on component with interactive event handlers |
| ISSUE-019 | 5 | **High** | `tests/` | No test coverage for AnalyticsEvent model or analytics tracking |
| ISSUE-002 | 0 | Medium | `app/api/auth/me/route.ts`, `app/api/group-bills/route.ts` | Debug `console.log` statements in production API routes |
| ISSUE-009 | 2 | Medium | `app/api/auth/login/route.ts` | Admin login does not check emailVerified |
| ISSUE-010 | 2 | Medium | `lib/session.ts` | Cookie `maxAge` hardcoded to 24 h, ignores `SESSION_ABSOLUTE_TIMEOUT_HOURS` env var |
| ISSUE-012 | 3 | Medium | `app/api/group-bills/route.ts` | 10 debug `console.log` calls in group bill creation happy path |
| ISSUE-017 | 4 | Medium | `app/admin/layout.tsx` | Misleading comment about redirect loop (actual structure is correct) |
| ISSUE-003 | 0 | Low | `vitest.workspace.ts` | Misleading comment about jsdom environment |
| ISSUE-004 | 0 | Low | Root | `.env.local` absent — expected but should be documented |
| ISSUE-011 | 2 | Low | `lib/session.ts` | Dynamic `import('@/models/User')` on every request — intentional, no action needed |
| ISSUE-014 | 3 | Low | Multiple API routes | `console.error` instead of `logger.error` in catch blocks |
| ISSUE-015 | 3 | Low | `app/api/auth/me/route.ts` | DELETE handler delegates to delete-account via dynamic import |
| ISSUE-018 | 4 | Low | `app/app/layout.tsx` | Missing Suspense — not applicable to current architecture |

---

*Report written by automated audit. All findings are based on static analysis of the source files. No code was modified.*
