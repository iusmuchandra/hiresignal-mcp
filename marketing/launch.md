# HireSignal — Launch Kit

Positioning: **The hiring-signal layer for GTM agents.** Turn live job postings into
buying signals any AI agent can call over MCP. Not a job board. Not a recruiting tool.
Not trying to out-data ZoomInfo — the easiest way to give an agent fresh hiring signals.

**Primary audience: people *building* GTM/sales agents** (Clay/Cursor/Claude/Cline tinkerers,
indie GTM-tool makers, RevOps engineers automating outbound). They live in MCP clients, they
feel the "I'd have to wire up SerpApi + JSearch + velocity math myself" pain, and they're the
only buyer you can actually reach *through the channel you've already built (MCP)*.
**Secondary:** RevOps / SDR leaders / founders doing outbound — real budget (comps: PredictLeads
~$490/mo, Clay $149–720/mo), but they don't live in Cursor, so sell to them later via the builders.

Why a builder picks this: one `mcp-remote` line instead of a SerpApi/JSearch integration,
recency windows, dedup, and a growing/stable/shrinking velocity signal you'd otherwise hand-roll.
Composable — chain it with your enrichment/email tools in the same agent loop.

Instant trial (put this in every post):
```
URL:    https://hiresignal-mcp-production-d4d9.up.railway.app/sse
Header: Authorization: Bearer hs_demo_0b25932234553fd38b571f12c1439bfd
```

---

## 0) Where the builders actually are (do these FIRST — highest leverage)

The X/LinkedIn/Reddit-sales posts below reach the *buyer*, not the *user*. For v1 your job is
to get **agent-builders** to connect the demo key. Prioritize channels where they hang out:

- **MCP registry + [Smithery](https://smithery.ai)** — make sure the listing is live, the
  tool list reads well, and install is one copy-paste. This is your storefront; most discovery
  starts here. Verify `io.github.iusmuchandra/hiresignal` resolves and the demo key works.
- **"Awesome MCP Servers" lists** — open a PR adding HireSignal under a GTM/sales/data category
  (e.g. punkpeye/awesome-mcp-servers and similar). Free, durable, exactly your audience.
- **r/mcp, r/ClaudeAI, r/cursor, the Cursor/Cline/MCP Discords** — post the 60s demo, framed as
  "an MCP server you can drop into a sales agent," not as a sales pitch. Ask what signal to add.
- **Clay community / GTM-engineering circles** — Clay builders chain signals for a living; an
  MCP-native hiring signal is directly composable. Show it feeding a Clay-style enrichment loop.
- **Show HN** (section 2) — builder-heavy, rewards a working demo + candor. Single biggest hit
  if it lands.

Only after a builder integrates it does the RevOps/X/LinkedIn audience (sections 3–5) matter —
they become the *demand* the builders are serving. Keep those, but treat them as second wave.

> **DONE (2026-07-03): the builder-cut demo exists** — `marketing/demo.gif` (recorded via
> `vhs marketing/demo.tape`, re-recordable anytime; warm the cache with one `node scripts/demo.mjs`
> run first). It's embedded at the top of the README and is the gif to attach to the X thread,
> r/mcp, and Reddit posts. The chat-cut below (Claude Desktop screen recording) is still worth
> recording for LinkedIn/HN comments, but it is no longer a launch blocker.

## 1) Demo script (60-second screen recording)

Goal: show Claude (with HireSignal connected) turning a hiring signal into a
prospecting action — the whole "aha" in under a minute. Record at 1080p, no audio
needed (add captions), keep cursor movements slow.

**Setup shot (0:00–0:05)**
- Claude Desktop open. On screen, a caption: *"HireSignal MCP connected — 8 tools."*
- Briefly show the tools list so viewers see it's real (`search_jobs`,
  `company_hiring_velocity`, `competitor_talent_intel`, …).

**Beat 1 — find in-market accounts (0:05–0:25)**
Type this prompt:
> "Find companies that posted a RevOps or Sales Operations role in the last 7 days.
> These are accounts likely about to buy sales tooling — list company, role, and when."

Let it call `search_jobs` / `job_alert_check` and return a list. Caption:
*"A new RevOps req = budget approved, ~60–90 days before they shop for vendors."*

**Beat 2 — score one account (0:25–0:40)**
> "Is Ramp scaling or freezing its go-to-market team right now? Should I prioritize it?"

Let it call `company_hiring_velocity`. It returns growing/stable/shrinking + dept mix.
Caption: *"Account scoring from real hiring velocity."*

**Beat 3 — turn signal into action (0:40–0:58)**
> "Draft a 3-sentence cold email to the RevOps leader at the top account, referencing
> that they're hiring for RevOps."

It writes a personalized email grounded in the signal. Caption:
*"Signal → prioritized account → personalized outreach. All in one agent."*

**End card (0:58–1:00)**
- Text: *"HireSignal — hiring-intent signals for your AI sales agent.
  Try it free: [repo/registry link]"*

> Tip: pre-run the queries once so the recording isn't waiting on API latency, then
> record the clean take. If the demo key is quota-limited that day, use your hs_live key
> for recording and show the demo key in the end card.

> **Builder cut (record this too — it's the one your primary audience cares about):** instead
> of a chat, show the connect step — one `mcp-remote` line in a Cursor/Claude config — then an
> *agent loop* using `job_alert_check` to poll for new reqs and hand each to an enrichment/email
> step. Frame: "drop-in hiring signal for your sales agent — one MCP server, not three API
> integrations." This is the demo that belongs on r/mcp, Smithery, and the Awesome-MCP PR.

---

## 2) Show HN

**Title:**
`Show HN: HireSignal – Turn job postings into B2B buying signals (MCP server)`

**Body:**
> I kept seeing the same GTM trick: when a company posts a new RevOps/VP Sales/Data
> Security role, it has an approved budget and a pain — usually 60–90 days before it
> starts evaluating vendors. The data to act on that exists, but it's either locked in
> $40k/yr platforms or buried as a "secondary" field in contact databases.
>
> HireSignal is a small MCP server that exposes hiring signals as tools an AI agent can
> call directly: search live postings, measure a company's hiring velocity (growing /
> stable / shrinking), compare a shortlist of target accounts, poll for new reqs, and
> pull salary/skill-demand context. So you can ask Claude "which fintechs posted a
> RevOps role this week, and which are scaling fastest?" and act on the answer.
>
> It's intentionally narrow and agent-native. It's not trying to out-data ZoomInfo — it's
> the easiest way to give an AI sales agent fresh hiring signals over MCP. For a curated set
> of ~50 high-value companies it scrapes their own ATS (Greenhouse/Ashby/Lever/Workday) directly and
> keeps a time-series, so `company_hiring_velocity` returns real roles-added/closed over time
> (data_source: first_party_ats), $0 per query; everything else falls back to a search
> aggregator. Stored in a single SQLite file via Node's built-in driver — no extra deps.
>
> Live demo (shared rate-limited key, point any MCP client at it):
> URL: https://hiresignal-mcp-production-d4d9.up.railway.app/sse
> Header: Authorization: Bearer hs_demo_0b25932234553fd38b571f12c1439bfd
>
> It's on the official MCP registry as io.github.iusmuchandra/hiresignal. Repo + tool
> list: [GitHub link]. Honest about limits: the free data tier is thin, signals are
> directional with confidence scores, and small samples are flagged. Would love feedback
> on whether the velocity/competitor tools are actually useful for your prospecting, and
> what signal you'd want next (funding, headcount on LinkedIn, tech-stack changes).

(HN rewards candor and a working demo over hype. Reply to every comment fast.)

---

## 3) X / Twitter thread

**1/**
> A company posting a new "RevOps Manager" or "VP Sales" role is one of the strongest
> buying signals in B2B — budget's approved, the pain is real, and it's usually 60–90
> days *before* they start talking to vendors.
>
> So I made it callable by your AI agent. 🧵

**2/**
> HireSignal is an MCP server. Connect it to Claude/Cursor and ask:
> "Which fintechs posted a RevOps role this week, and which are scaling fastest?"
>
> It pulls live postings, measures hiring velocity, and ranks the accounts. No dashboard.

**3/**
> 8 tools your agent can call:
> • find roles that imply your category (in-market accounts)
> • company hiring velocity → account scoring
> • compare a shortlist of target accounts
> • new-req alerts for cron/agent loops
> • salary + skill-demand context
> [30-sec demo gif]

**4/**
> It's deliberately not "another ZoomInfo." It's the easy, agent-native way to get fresh
> hiring signals over MCP. On the official MCP registry now.

**5/**
> Try it in 60s — point any MCP client here:
> URL: https://hiresignal-mcp-production-d4d9.up.railway.app/sse
> Bearer: hs_demo_0b25932234553fd38b571f12c1439bfd
>
> What signal should I add next — funding, headcount, tech-stack changes? 👇

---

## 4) LinkedIn (the actual buyer hangs out here)

> **The best buying signal in B2B is hiding in plain sight: job postings.**
>
> When a company posts a RevOps Manager, a first VP of Sales, or a Data Security Analyst,
> it's telling you three things: there's budget, there's a pain, and there's a 60–90 day
> window before they start evaluating vendors.
>
> Most teams can't act on this — the data's locked in $40k/yr platforms or stale inside a
> contact database. So I built HireSignal: a tool that lets your AI assistant read hiring
> signals directly.
>
> Ask it: *"Which fintechs posted a RevOps role this week, and which are scaling fastest?"*
> — and get a ranked list of in-market accounts, scored by real hiring velocity, in
> seconds.
>
> It's free to try (link in comments). If you run outbound or RevOps, I'd genuinely love
> to know: is hiring velocity a signal you'd build a play around? What would make it a
> daily tool for you?
>
> #sales #revops #gtm #prospecting #ai

(Put the demo link in the FIRST comment, not the post — LinkedIn suppresses posts with
external links.)

---

## 5) Reddit (r/sales, r/RevOps, r/SaaS — read each sub's self-promo rules first)

**Title:** I built a free tool that turns job postings into buying signals for your AI assistant — looking for feedback

**Body:**
> Not selling anything (there's a free demo key below). I kept noticing that a new
> RevOps/VP Sales req is basically a "we have budget and a pain" flag, 1–3 months before
> a company shops for vendors. I made that queryable by an AI agent (Claude/Cursor via MCP).
>
> You can ask things like "which fintechs posted a RevOps role this week and which are
> scaling fastest" and get a ranked list. It also does account scoring by hiring velocity
> and side-by-side comparison of a target list.
>
> Honest limits: deep-not-wide — ~50 curated companies are scraped first-party from their
> ATS with real hiring-velocity history; everything else falls back to a search aggregator
> and is more directional. I want to know if this is actually useful for prospecting or if
> I'm fooling myself. Demo (point any MCP client at it):
> URL: https://hiresignal-mcp-production-d4d9.up.railway.app/sse
> Bearer: hs_demo_0b25932234553fd38b571f12c1439bfd

---

## Launch sequencing (do in this order, same day)

1. Make sure the v0.3.0 registry listing is live + the demo key works. *(Done 2026-07-01:
   v0.3.0 published to the registry, server live on Railway with the first-party corpus
   ingesting every 6h on a persistent volume, live + demo keys verified over SSE.)* **Then do section 0:**
   verify Smithery/registry listing, open the Awesome-MCP-Servers PR. These are durable and
   reach builders without a launch-day spike.
2. Record + attach the 60s demo gif/video to every post — record **both** cuts (chat + builder).
   This is the single biggest lever.
3. Post Show HN in the morning (US time). Reply to every comment within minutes.
4. Post to r/mcp, r/ClaudeAI, r/cursor + the MCP/Cursor Discords (builder cut). This is your
   primary audience — weight effort here.
5. Post the X thread + LinkedIn an hour later; cross-link the HN thread if it's getting traction.
   Treat these (and r/sales) as the *second wave* — buyer demand, not first users.
6. Watch for connections (set up usage monitoring) — the only metric that matters today is
   "did a stranger connect and call a tool?" The win condition: a builder asks for their own key.

## What to measure
- # of unique sessions / tool calls on the demo key (proxy for interest)
- Which tools get called (tells you what people actually want)
- Any reply asking "can I get my own key / higher limits" = your first real lead
