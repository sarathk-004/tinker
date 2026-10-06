# Costs and limits (checked 2026-10-06)

Prices and limits change. Every figure below was read from the provider's own page on 2026-10-06 and is listed with its source; re-check
before committing to a plan. Nothing here is a quote. "Estimate" marks anything we computed ourselves, with its assumptions.

## What this project's accounts are on today
- Supabase organization "Tinker": **Free** plan (read from the project through the Supabase connector). Region: ap-southeast-1.
- Gemini: the key in `.env` is on a free tier (the older preview speech models returned "quota exceeded ... 10 requests" on 2026-10-06).
- Railway, Cloudflare: no account is connected to this repository; nothing is deployed.

## Supabase (https://supabase.com/pricing, https://supabase.com/docs/guides/platform/backups)
| | Free | Pro |
|---|---|---|
| Price | $0 | from $25 / month |
| Database size | 500 MB | 8 GB |
| Egress | 5 GB | 250 GB |
| Auth monthly active users | 50,000 | 100,000 |
| Inactivity | **paused after 1 week** | never paused |
| Compute | shared | $10 / month credit (a Micro instance) |
| Daily backups | **none** (export manually) | last 7 days (Team 14, Enterprise 30) |
| Point-in-time recovery | **not available** | add-on, $100 / month per 7 days of retention; needs at least the Small compute add-on ($15 / month) |
| PITR granularity | - | worst-case RPO about 2 minutes (documented) |

Consequences for Tinker:
- **Free is fine for development and demos and wrong for real users**: the database pauses after a week without use, and there is no provider backup to restore from. The Phase 1 targets (RPO <= 5 min, RTO <= 60 min) need Pro **plus** PITR. Estimate of the cheapest compliant database: $25 (Pro) + $15 (Small compute) + $100 (PITR, 7 days) = about $140 / month, before the $10 compute credit. Provider restore time (RTO) is not stated by Supabase ("depends on the size of the database"); only our own drill is measured (runbook section 6).
- Our own logical backup (`npm run backup:drill`) works on any plan and bounds the loss window by how often it runs.
- The database size is dominated by revisions (each is a full snapshot). The worker keeps the latest 100 plus 30 days. A 20-node diagram revision is roughly 5 KB, so a diagram with 100 revisions is about 0.5 MB (estimate).

## Gemini API (https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/rate-limits)
Per 1M tokens, as listed on the pricing page:
| Model (use) | Input | Output |
|---|---|---|
| gemini-3.5-flash-lite (free-form typed commands and advice; our default) | free tier | $2.50 |
| gemini-3.8-flash | free until 2026-12-31, then $1.50 | free until 2026-12-31, then $7.50 |
| gemini-3.8-flash-tts (spoken replies, first choice) | free until 2026-12-31, then $1.00 | free until 2026-12-31, then $18.00 |
| gemini-3.8-flash-lite-tts (spoken replies, fallback) | free until 2026-12-31, then $1.00 | free until 2026-12-31, then $12.00 |
| gemini-3.8-live (voice requests, audio) | free until 2026-12-31, then $3.00 | audio output $12.00 (we discard the model's speech but may still be billed for it: LC31) |

- Rate limits are per **project** (not per key), measured in requests per minute, tokens per minute and requests per day; the exact per-model numbers are only shown in Google AI Studio's dashboard. Tiers: Free; Tier 1 needs a linked billing account ($250 spend cap); Tier 2 needs $100+ cumulative spend and 3 days; Tier 3 $1,000+ and 30 days. Daily quotas reset at midnight Pacific time.
- Estimate for typed AI: a free-form command is assumed to send about 1,000 input tokens and return about 200 output tokens (an assumption, not a measurement: usage is not logged yet, LC26). 1,000 such commands cost about 200,000 output tokens x $2.50 / 1M = **$0.50** on the paid rate (input listed as free). Plain commands the parser understands cost nothing.
- Voice and spoken replies are the expensive part and have **not** been costed from real use (LC31, LC33). Spoken replies are limited to about 220 characters, and the user can switch to the browser's free voice.
- In-app limits that protect the bill (per user, in memory): 10 model requests / minute, 2 at once, 15 s deadline, voice sessions of at most 10 minutes. There is no global spend cap in the app: set a budget alert and API key restrictions in Google AI Studio / Cloud (LC26, user action).

## Railway (https://docs.railway.com/reference/pricing/plans)
| | Free | Hobby | Pro |
|---|---|---|---|
| Plan price | $0 | $5 / month | $20 / month |
| Included usage credit | $0 | $5 | $20 |
| Per-service limit | 0.5 GB RAM, 1 vCPU | 48 GB, 48 vCPU | 1 TB, 1,000 vCPU |
Usage: RAM $10 / GB / month, CPU $20 / vCPU / month, egress $0.05 / GB. Estimate: an API at about 0.25 GB average RAM and 0.1 vCPU plus a worker at about 0.1 GB and near-zero CPU is roughly $3-5 / month of usage, which the Hobby credit covers (assumption: low traffic; measure after deploying).

## Cloudflare Pages (https://developers.cloudflare.com/pages/platform/limits/)
Free plan: 500 builds / month, 20,000 files per site, 25 MiB per file, 100 custom domains, 100 `_headers` rules, 2,100 redirect rules. Our site is a handful of files. The page does not state a bandwidth limit for the free plan; the static site does not host the API or WebSockets (those are on Railway).

## Where the money goes first (order of magnitude)
1. A paid Supabase plan with PITR if real users and the stated recovery targets matter (about $140 / month by the figures above).
2. Gemini voice and spoken replies once the free period ends (unmeasured).
3. Hosting (a few dollars).
