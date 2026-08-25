# EFFY Ambassador Intelligence System · V2 Deployment

Next.js 14 (App Router) + Neon Postgres, deployed on Vercel.

V2 turns the dashboard into a five-layer system: performance intelligence,
ambassador development, coaching intervention tracking, historical performance
measurement, and organizational learning.

---

## 1. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres connection string. Server-side only. |
| `SESSION_SECRET` | Yes in production | Signs the HttpOnly session cookie. The app refuses to start a session in production without it. No fallback value exists. |
| `AI_PROVIDER` | No | `groq` (default) or `google`. |
| `GUEST_VIEW` | No | `on` (default) lets anyone with the URL see Overview, Performance and Analytics without signing in. Set to `off` to require a login for all data. |
| `GROQ_API_KEY` | If using Groq | Server-side only. |
| `GOOGLE_AI_API_KEY` | If using Gemini | Server-side only. |
| `GROQ_MODEL` | No | Overrides the Groq model without a code change. Default `openai/gpt-oss-120b`. |
| `GROQ_MODEL_FALLBACK` | No | Used automatically if the primary is retired or rate limited. Default `openai/gpt-oss-20b`. |
| `GOOGLE_MODEL` | No | Default `gemini-2.5-flash`. |
| `GOOGLE_MODEL_FALLBACK` | No | Default `gemini-2.5-flash-lite`. |

Never commit real values. `.env.example` documents the shape only.

## 2. Database migration

Run the migration once in the Neon SQL editor:

```
migrations/001_v2_core.sql
```

It is additive and preserves existing `coaching_store` and `coaches` data.
It adds: the `role` column (backfilled from `is_admin`), `dataset_snapshots`,
`audit_log`, `usage_events`, and `coaching_interventions`, plus indexes.
Nothing is dropped. Do not run destructive migrations automatically.

## 3. User roles

| Role | Can do |
|---|---|
| `viewer` | View authorized performance, coaching and development information. No modifications. |
| `coach` | Everything a viewer can do, plus record field observations, role-play assessments, coaching journeys, group development, and generate AI coaching. |
| `admin` | Everything a coach can do, plus Excel dataset refresh, dataset changes, system export, and administrative actions. |

Add or update accounts:

```sql
select add_coach('name@effy.com','Full Name','StrongPassword', true);            -- admin
select add_coach('coach@effy.com','Coach Name','StrongPassword', false);         -- coach
select add_coach('viewer@effy.com','Viewer Name','StrongPassword', false,'viewer');
```

Passwords are hashed with pgcrypto. Authorization is enforced on the server for
every protected action, never by hiding buttons.

## 4. Dataset refresh and snapshots

An admin uploads the weekly Excel file from the dashboard banner. On success:

1. the parsed dataset is saved as the live dataset for fast loading;
2. an immutable row is written to `dataset_snapshots`, stamped with the actual
   server timestamp, the uploader, and the source filename;
3. audit events are recorded.

Snapshots are never overwritten. Period-over-period movement is calculated by
comparing the two most recent real snapshots, labelled **Since Previous
Refresh**. With only one snapshot the interface states that historical
comparison is not yet available rather than fabricating movement.

## 5. AI usage and cost control

Model names are set by environment variable, so a provider deprecation is a
Vercel change rather than a release. Both providers fall back automatically to a
smaller model if the primary returns "not found", "decommissioned" or a rate
limit, so a retirement degrades service instead of breaking it.

Cost controls, which matter as the coach base grows:

- **Response cache** (`ai_cache`): an identical request within six hours returns
  the stored answer and spends nothing. Re-opening the same profile is free.
- **Per-purpose output caps**: coaching 1,100 tokens, group 1,100, curriculum
  modules 1,600, debrief 800, with a hard ceiling of 2,500. The browser cannot
  raise these.
- **Per-user rate limit**: 60 AI calls per hour per coach, tracked in the
  database so it holds across serverless instances.
- **Audit trail**: every generation records the provider, output cap and
  approximate prompt size, and cache hits are logged separately, so real usage
  can be measured rather than guessed.

Run `migrations/002_ai_cache.sql` to enable the cache. Without it the app still
works; it simply spends tokens on repeat requests.

## 6. Guest view

With `GUEST_VIEW=on` (the default) an unauthenticated visitor can open the
dashboard and see **Overview, Performance and Analytics** with the current live
dataset. Opening **Development** prompts for sign-in.

Guests can never: record coaching, edit anything, read coaching journeys, field
notes, role-play notes or group development, view snapshot comparisons, refresh
the dataset, export, or use AI coaching. Those all require a session server-side.

Trade-off worth stating plainly: guest view means anyone with the URL can see
ambassador performance figures. If that is not acceptable, set `GUEST_VIEW=off`
and issue `viewer` accounts instead.

## 7. Security model

- Sessions are HttpOnly, SameSite=Lax, Secure in production, path `/`, 12 hours.
  The signed value is never readable from JavaScript.
- The ambassador roster and performance dataset are **not** bundled into client
  JavaScript. They load from `/api/dataset` only after authentication.
- Every store action requires a session. Export and dataset refresh require
  admin. Coaching writes require coach or admin.
- Store keys are validated against known namespaces (`spine:`, `fb:`, `rp:`,
  and named application keys). Global keys require admin.
- AI generation requires coach or admin, clamps output tokens server-side,
  limits body and prompt size, times out, and is rate limited in the database.
- Login is rate limited per email plus IP in `usage_events`. Plaintext passwords
  are never logged.
- All SQL is parameterized.

## 8. Business rules

All rules live in `lib/performanceRules.js`. Do not redefine them elsewhere.

- Contract gap: `CONTRACT_GAP_VOYAGES = 5`
- Greyout gap: `GREYOUT_GAP_VOYAGES = 4`
- Reporting timezone: `America/New_York`, displayed as **ET** (handles EST and
  EDT automatically; no fixed UTC offsets anywhere)
- Performance week: Monday to Sunday
- Non-revenue threshold: `-99`
- All twelve months are supported. No six-month limits exist.

KPI definitions, single-sourced and unit tested:

- Sales vs Budget = accumulated sales / accumulated budget (never an average of
  percentages). Zero-budget voyages are excluded and cannot corrupt it.
- AUR = total sales / total units
- ATV = total sales / total transactions
- UPT = total units / total transactions
- Budget Sales Gap = sales - budget
- Sales and Avg / Voyage are reported as separate measures; an average is never
  labelled as a total.

## 9. Local development

```bash
npm install
npm test          # node --test, no extra dependency
npm run build
npm run dev
```

`dev-fixtures/sample-dataset.json` holds a sample roster for local work. It is a
development fixture only and is never imported by client code, so it cannot
reach the production bundle.

## 10. Adding a cruise line

See `ADDING_A_CRUISE_LINE.md`. Cruise lines are derived from the Excel sheets at
parse time, so a new line appears automatically with a fallback palette.
