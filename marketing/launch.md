# HireSignal — Launch Kit

Positioning: **Hiring-intent signals for B2B sales/GTM.** Turn live job postings into
buying signals your AI agent can call. Not a job board. Not a recruiting tool.

Buyer: RevOps / SDR leaders / founders doing outbound / builders of AI sales agents.

Instant trial (put this in every post):
```
URL:    https://hiresignal-mcp-production-d4d9.up.railway.app/sse
Header: Authorization: Bearer hs_demo_0b25932234553fd38b571f12c1439bfd
```

---

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
> the easiest way to give an AI sales agent fresh hiring signals over MCP. Data comes from
> Google Jobs (SerpApi) + JSearch today.
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
> Honest limits: data's from Google Jobs + JSearch right now, signals are directional with
> confidence scores. I want to know if this is actually useful for prospecting or if I'm
> fooling myself. Demo (point any MCP client at it):
> URL: https://hiresignal-mcp-production-d4d9.up.railway.app/sse
> Bearer: hs_demo_0b25932234553fd38b571f12c1439bfd

---

## Launch sequencing (do in this order, same day)

1. Make sure the v0.2.0 registry listing is live + the demo key works.
2. Record + attach the 60s demo gif/video to every post (this is the single biggest lever).
3. Post Show HN in the morning (US time). Reply to every comment within minutes.
4. Post the X thread + LinkedIn an hour later; cross-link the HN thread if it's getting traction.
5. Reddit last, tailored per sub, only where self-promo is allowed.
6. Watch for connections (set up usage monitoring) — the only metric that matters today is
   "did a stranger connect and call a tool?"

## What to measure
- # of unique sessions / tool calls on the demo key (proxy for interest)
- Which tools get called (tells you what people actually want)
- Any reply asking "can I get my own key / higher limits" = your first real lead
