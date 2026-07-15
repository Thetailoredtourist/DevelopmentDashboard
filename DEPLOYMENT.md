# EFFY Ambassador Dashboard — Web App

A Next.js app version of the Ambassador Command Center. Runs in any modern
browser on desktop and mobile, with the Anthropic API key kept server-side.

---

## What you need

- Node.js 18.18 or newer (you already have Node installed; check with `node -v`)
- An Anthropic API key from https://console.anthropic.com (only needed for the
  AI coaching and the Development Lab; the rest of the dashboard runs without it)

---

## First-time setup (about 2 minutes)

1. Open a terminal in this folder (the folder that contains `package.json`).

2. Install the dependencies:

   ```
   npm install
   ```

3. Create a file named `.env.local` in this same folder (copy `.env.example`
   to `.env.local`) and paste in your free Groq key:

   ```
   GROQ_API_KEY=gsk_your_real_key_here
   ```

   That is all you need. The AI coaching uses Groq by default (fast, free).

   Optional fallback: if you ever want to switch to Google AI Studio, get a
   free key at https://aistudio.google.com/app/apikey, add it as
   `GOOGLE_AI_API_KEY=...`, and change one line in
   `app/api/coaching/route.js`: set `const PROVIDER = "google";`

---

## Run it on your computer

```
npm run dev
```

Then open http://localhost:3000 in your browser. The dashboard loads with the
current data. Leave the terminal window open while you use it; closing it stops
the app.

To stop the app, press Ctrl+C in the terminal.

---

## Run the production build (faster, for everyday use)

```
npm run build
npm run start
```

Then open http://localhost:3000. This is the optimized version.

---

## Admin lock on the data refresh

The data-refresh button (the icon under the EFFY logo) is locked. Other users
see a padlock and cannot load a new file. Only you, after entering the admin
password, can upload a fresh Excel export.

- Default password: `EffyAdmin2026`
- To change it: open `components/Dashboard.jsx`, edit the line
  `const ADMIN_PASSWORD = "EffyAdmin2026";` near the top, then rebuild
  (`npm run build`).
- The unlock lasts until you refresh or close the browser tab, then it locks
  again. This is a convenience gate to prevent accidental or casual refreshes,
  not bank-grade security.

## Updating the data each Tuesday

Click the circular refresh icon (top right, under the EFFY logo) and choose your
latest `Ambassador_Stats.xlsx` export. The dashboard re-reads the file in the
browser, applies the contract-reset and current-week logic, and refreshes every
view. Nothing is uploaded to a server; the file is parsed locally.

The bundled `candidate-data.json` is the starting snapshot. To change the data
the app loads on first open, replace that file with a fresh export-derived JSON.

---

## Putting it online (optional)

The easiest host is Vercel (made by the Next.js team):

1. Push this folder to a private GitHub repository.
2. Go to https://vercel.com, "Add New Project", and import the repository.
3. In the project settings, add an Environment Variable:
   `GROQ_API_KEY` = your key (and optionally `GOOGLE_AI_API_KEY`).
4. Deploy. Vercel gives you a private URL you can open on any device.

Any host that runs Next.js 14 works the same way. Keep the API key in the host's
environment variables, never in the code.

Note: Vercel free Hobby tier is for non-commercial use; for a company tool, the Pro tier or running it on an internal machine keeps you fully compliant.

---

## Notes

- The "Download PDF" button on a profile generates a real PDF and opens your
  device's save dialog (Files, cloud, or desktop).
- The mobile view is the phone icon at the top-left of the header.
- Coaching notes and reviews are stored in your browser (localStorage) on the
  device you use them on; they are not shared between devices.
- Adding a new cruise line is covered in ADDING_A_CRUISE_LINE.md.
