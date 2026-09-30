# job-radar

Every 20 minutes this repo reads public job-board APIs and sends new developer roles, open to India or
remote worldwide, to one private Telegram chat. It has no website and republishes nothing.

## What it reads
- **Company career boards** in [`companies.json`](companies.json), through each ATS's public, keyless job-board API:
  Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee. Every board is read on every run, with
  1 s between requests to the same host.
- **Himalayas** (full-time and intern searches), once a day, because its API data refreshes every 24 hours. Credited
  as "via himalayas.app" with the job link, as its terms ask.
- **Jobicy** (remote dev jobs), at most once an hour, as its terms ask. Credited as "via jobicy.com".

Not read: LinkedIn, Naukri, Indeed, Glassdoor, Wellfound, Upwork, Freelancer.com, RemoteOK, and any HTML page.

## Rules (no AI)
- Title names an engineering or developer role and is not senior, lead, staff, principal, manager, director and the like.
- Location names India or an Indian city, or anywhere / worldwide / global / APAC / Asia, or just "Remote".
- Posted in the last 72 hours. A source without dates: only roles that appear after its first read.
- At most 25 messages per IST day, newest first; 23:00–07:00 IST messages wait until 07:00.
- `💰 Hourly / contract` when the role is marked contract, contractor, part-time, temporary or freelance, or the text
  mentions hourly pay, freelance, a contract role or a paid trial.

## How it runs
`.github/workflows/radar.yml` is started by a cron-job.org job through `workflow_dispatch` at :00, :20 and :40.
GitHub's own `schedule` at the same minutes is a fallback: it starts late, but it keeps the radar alive if the
cron-job.org job is missing or its token has expired.
It runs only when the repository variable `RADAR` is `on`. Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

State is on the `state` branch: `sources.json`, `seen/`, `pending.json`, `days/<date>.jsonl` (what was sent or went
over the cap) and `companies-added.json` (companies added from Telegram with `/company <url>`).

This repo only **sends** Telegram messages. It never reads the bot's updates: another program reads them, and two
readers lose each other's messages. A test checks this.

## Develop
```
npm test
```
Node 22+, no dependencies.
