# Future To-Do — Optional Integrations

These items are already wired into the codebase but are **disabled by default** (guarded by environment variable checks).
No code changes are needed — just set the environment variable in Vercel when you're ready.

---

## 1. Error Tracking — Sentry

### What it does
Automatically captures every unhandled exception and promise rejection on the server and sends you an alert.
Without it, errors still appear in Vercel logs — you just have to check them manually.

### When to add it
Before you onboard your first paying tenant, or whenever you want proactive crash notifications.

### How to set it up
1. Go to **[sentry.io](https://sentry.io)** → sign up (free tier is enough for a startup)
2. Create a new project → select **Node.js**
3. Copy the DSN — it looks like:
   ```
   https://abc123xyz@o123456.ingest.sentry.io/7891234
   ```
4. In your **Vercel dashboard** → Project Settings → Environment Variables:
   ```
   SENTRY_DSN = https://abc123xyz@o123456.ingest.sentry.io/7891234
   ```
5. Redeploy — done. Sentry will start receiving errors immediately.

### What's already done in the code
- `@sentry/node` is installed (`server/package.json`)
- Sentry is initialized in `server/src/index.ts` before any routes load
- `process.on('unhandledRejection')` and `process.on('uncaughtException')` hooks are registered
- Sentry's Express error handler is mounted after all routes

---

## 2. Dead-letter Job Alerting — Slack / Discord Webhook

### What it does
After every background sync worker run, the server checks how many ingestion jobs are stuck in the `dead_letter` state.
If the count meets or exceeds the threshold, it fires a POST to your webhook URL — delivering a message like:

> ⚠️ *Mamba Ingestion Alert* — 3 job(s) in dead-letter queue. Check the monitoring dashboard.

Without it, dead-letter jobs are still visible on the **Ingestion Monitoring** dashboard — you just won't get a proactive ping.

### When to add it
Once you have multiple sellers syncing regularly and you don't want to manually check the dashboard every day.

### How to get a webhook URL

**Option A — Slack** (recommended)
1. In your Slack workspace → click **Apps** (left sidebar) → search "Incoming Webhooks"
2. Click **Add to Slack** → choose a channel (e.g. `#mamba-alerts`)
3. Copy the generated URL — it looks like:


**Option B — Discord**
1. Open any Discord server you own → go to a channel → **Edit Channel** → **Integrations** → **Webhooks**
2. Click **New Webhook** → Copy Webhook URL — it looks like:
   ```
   https://discord.com/api/webhooks/1234567890/XXXXXXXXXXXXXXXXXXXXXX
   ```

**Option C — Custom endpoint**
Any URL that accepts a `POST` with a JSON body `{ "text": "..." }` will work.

### How to activate
In your **Vercel dashboard** → Environment Variables:
```
DEAD_LETTER_WEBHOOK_URL = https://hooks.slack.com/services/T.../B.../xxx
DEAD_LETTER_ALERT_THRESHOLD = 1   # alert when even 1 job is dead-lettered (default)
```

Redeploy — alerts will fire automatically after the next worker run.

### What's already done in the code
- After each `POST /sync/run-worker` completes, the worker queries `ingestion_jobs WHERE status = 'dead_letter'`
- If the count ≥ `DEAD_LETTER_ALERT_THRESHOLD`, it POSTs to `DEAD_LETTER_WEBHOOK_URL`
- The alert is fire-and-forget — it never blocks or crashes the worker if the webhook is unreachable

---

## 3. Supabase Connection Pooler (Production Performance)

### What it does
By default, each Vercel serverless function invocation opens a **direct PostgreSQL connection**.
Under load (many concurrent requests), you can hit Supabase's direct connection limit (typically 60–100 on free/Pro).
Switching to the **PgBouncer Transaction Pool** endpoint (port `6543`) recycles connections efficiently.

### When to add it
Before you expect more than ~20 concurrent API requests, or if you start seeing `too many connections` errors in Vercel logs.

### How to set it up
1. Go to your **Supabase dashboard** → Project Settings → **Database** → **Connection Pooling**
2. Copy the **Transaction mode** connection string — it contains port `6543`
3. Build your `SUPABASE_URL` from it:
   ```
   # Example — replace with your actual project ref
   SUPABASE_URL = https://xyzabcdef.supabase.co   ← keep using this (Supabase JS handles pooling internally)
   ```
   > **Note:** Supabase JS v2 client with `auth.persistSession: false` already reuses connections efficiently in serverless environments. The pooler is most beneficial if you add raw `pg` queries. Review your usage before switching — the current setup is already reasonably efficient.

---

## Summary Checklist

| Item | Priority | Estimated Setup Time |
|---|---|---|
| Sentry error tracking | Medium — add before first paying tenant | ~10 min |
| Dead-letter webhook (Slack) | Low — add when you have 5+ active sellers | ~5 min |
| Supabase connection pooler | Low — add if you see connection errors | ~5 min |
