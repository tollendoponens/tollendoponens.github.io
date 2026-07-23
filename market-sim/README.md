# Classroom double auction

A live, multi-computer classroom market. The instructor opens and closes the
market; producers post sell offers; consumers accept them. Everyone watches the
same offer chart. Runs entirely on GitHub Pages — no backend.

This is **step one** of a larger simulation, not the finished thing.

## Preview the dashboards without a class

Fake mid-round market, no networking:

```bash
python -m http.server 8000
```

- Instructor: <http://localhost:8000/?preview=teacher>
- Producer: <http://localhost:8000/?preview=student>
- Consumer: <http://localhost:8000/?preview=student&role=consumer>

Add `&goods=2` for the two-good market.

## Deploy to GitHub Pages

1. Push `index.html`, `style.css`, `state.js`, `net.js`, `chart.js`, `ui.js`, `app.js`.
2. **Settings → Pages → Deploy from a branch → main / (root) → Save**.
3. Live at `https://<user>.github.io/<repo>/` in about a minute.

## The market

**Roles.** Students are assigned producer or consumer as they join, whichever
side is short — so the class stays balanced at any size. The instructor can flip
anyone's role from the roster inspector.

**Round flow.** Each round is two instructor clicks, not one:

1. **Deal** → schedules are generated and pushed out, but the market stays shut.
   Students study their costs and values; the instructor reads the equilibrium
   the deal implies and sets price controls against it.
2. **Open market** → trading starts.
3. **Close market** → the round is scored and archived.

**Schedules.** At the deal, each student gets a schedule of `unitsPerPlayer`
prices: producers get **costs in increasing order**, consumers get **values in
decreasing order**. They're dealt off an aggregate ladder whose shape the
instructor sets (see *Curve shape*). Nobody sees anyone else's schedule —
private values are never sent over the wire, not merely hidden in the client.

**Two goods (optional).** With the toggle on, there are two books — Tin and
Copper — and each student holds a schedule for each. Capacity is **shared**:
`unitsPerPlayer` units total, spent on whichever good you like. That shared
constraint is what makes substitution real, and it's what a price signal is able
to redirect. Off by default; the market is a single good and every good-picker
hides itself.

**Externalities.** Each good can carry a spillover set **per person, per unit**:
negative for an external cost (pollution), positive for a benefit. It is **real
money**. Every trade debits *every student except the buyer and the seller* by
that amount, and it lands in their round net and their session total. The two
people who did the deal pay nothing and keep their whole gain.

Set it in quarters — you'll need to. At 20 students, $1 each is $18 a unit
socially, which swamps every trade and drives the social optimum to zero.
$0.25–$0.50 is the usable band for a class that size.

**Students are told about it**, next to the buy button: *"Every tin unit traded
takes $0.50 from every other student (18 people). The two people in the trade
pay nothing — including you, when it's yours."* Their round summary then reads:

| | |
|---|---|
| Trading profit | +$6 |
| You put on everyone else — *you don't pay this* | −$9 |
| Charged to you by other people's trades | −$2 |
| **Round net** | **+$4** |

That visibility is the point. The lesson isn't that traders are ignorant of the
damage — it's that knowing changes nothing, because the cost lands on other
people. A student can read the −$9 they caused, agree it's bad, and still be
individually better off trading. Anyone who does restrain themselves simply
earns less than the classmates who don't, which is the same lesson from the
other side. Both directions are worth naming in the debrief.

On the instructor's side it moves the scoreboard: the Efficiency tile becomes
**Social efficiency** (realized surplus plus spillover, over the best society
could have done), the briefing gains a **social optimum** quantity beside the
private one, and the S&D chart grows a dashed **social cost** curve — private
cost minus the externality — with the social quantity marked. A negative
spillover puts it above supply and the market over-trades; a positive one puts
it below and the market under-trades.

**Price controls.** The instructor can set a floor, a ceiling, both, or neither
(blank = none); they apply immediately, at any point in a round. Offers outside
the limits are refused **on the host**, and a standing offer that a newly
applied control outlaws is withdrawn from the book rather than left sitting
there illegally. A floor above a ceiling is refused outright — nothing would be
legal. Students see the active limits beside the book and as dashed lines on the
chart; the offer hint folds the floor into the price they're told to beat.

## The instructor's control cards

Split by *when you touch them*, because a card you scroll through mid-round is a
card you'll misclick:

**Live controls** (first, always open) — the pre-market briefing, price floor and
ceiling with their own *Apply controls*, and the supply-shock button. Everything
here bites immediately.

**Setup** (below) — round count and length, units per student, timed vs. manual,
the two-goods and keep-schedules switches, and two collapsed sections for the
fiddly bits: *Curve shape* and *Externalities*. Its *Apply setup* button takes
effect at the **next deal**, which the card says.

The two Apply buttons are deliberately separate and separately scoped — one
changes the world now, the other changes the next round.

**The pre-market briefing** shows the CE price band, CE quantity and maximum
surplus implied by the schedules just dealt, the social optimum when a spillover
is set, and a read on whether each price control would actually bite — binding,
inside the band and possibly binding, or slack. It's populated **before** the
market opens.

**Trading.** Only producers post offers, and **only one offer stands at a time —
the best one**. A new offer must strictly undercut the standing offer to take
the book; the producer who is displaced is told who undercut them and at what
price. **Prices are whole dollars only** — enforced on the host, not just in the
input. Consumers do not post bids: they accept the standing offer. A purchase
executes at the offer price, matches the seller's cheapest unsold unit against
the buyer's highest unbought unit, and **clears the book** — the chart starts a
new column and any price may open it again.

**Profit.** Producer profit is `price − cost`; consumer surplus is
`value − price`. Both are computed per unit, totalled per round, and banked into
a session total when the market closes.

**Instructor benchmarks.** The header tiles show trades, average price, and
efficiency — realized surplus as a share of the maximum available, with the
competitive-equilibrium quantity and price band computed from the aggregate
schedules. That's the number the discussion after the round is usually about.

## The offer chart

Both dashboards render the same chart: **one column per trade**. Every sell
offer posted in the run-up to a purchase is a dot in that trade's column,
stacked by price — since each offer must undercut the last, a column reads
top-to-bottom as the bidding came down. The orange dot at the foot of a column
is the offer that actually traded. The rightmost column is the trade in
progress.

**The box is a fixed size** and columns are deliberately narrow. Adding rounds,
switching to the all-rounds view or flipping to the table never resizes the
card — a wide plot scrolls sideways inside it instead. (The layout blowout this
replaced was grid children defaulting to `min-width:auto`, so wide content
stretched its own track; they're pinned to zero now.)

Prices carry no direct labels on the dots at all; the y-axis, the hover tip and
the
**Table** view (the toggle in the card header) carry the numbers instead — the
table also being the non-visual path to the same data. Both charts assign from
categorical slot 1 in fixed order, so supply keeps the blue that the sell side
already wears on the offer chart. The two series colors are dataviz categorical
slots 1 and 2, validated all-pairs against the white card surface: CVD ΔE 24.7
(protan), normal-vision ΔE 33.6, both above 3:1 contrast. The app is light-mode
only, so no dark variant is defined.

**Choosing what to chart.** Closed rounds are archived, and the dropdown beside
the Table toggle picks between any one of them, the live round, or **All
rounds**. The default is `Round N · live`, and it *follows* — open the next
round and the chart moves with it. Pinning a specific round instead keeps it
pinned; a 1Hz repaint won't knock the selection loose or close the dropdown
under your cursor. In the all-rounds view, trades are numbered within their own
round, and **round boundaries are marked by a dashed rule** — so you can watch
prices converge across the session in one picture. Both dashboards get the same
control; students' archived rounds go through the same private-value stripping
as the live one.

## Running the Hayek demonstration

The pieces are built; this is the running order. The argument is that a price
communicates what people need to know **without** telling them why — so the
demonstration has to (a) change something, (b) tell nobody, and (c) give people
somewhere else to go.

1. **Turn on both switches.** *Two goods* and *Keep schedules between rounds*.
   Two goods creates the alternative action; keeping schedules creates the
   stable baseline a shock can be measured against. Apply, then deal.
2. **Play a baseline round or two.** Prices settle near the CE band. Note where.
3. **Shock tin silently.** *Supply shock…* → Tin, +$6, half the producers,
   **announcement off**. Only the hit producers see anything — their own costs.
   Nothing enters the class feed.
4. **Play the next round.** Tin's price rises, copper's doesn't. Because capacity
   is *shared* across the two goods, buyers who keep buying tin give up copper —
   so the price does the reallocating, not an announcement.
5. **Ask them out loud why the price moved.** Show of hands, not software. The
   answer you're fishing for is "no idea — it just went up, so I bought copper
   instead": people acted correctly without knowing the cause.
6. **Now suppress the signal.** Repeat the shock with a **price ceiling** at the
   old price. The price can't move, so it can't inform: shortage instead of
   reallocation, and efficiency drops. Same shock, signal free vs. signal gagged.

Optional contrast: run a round as a central planner, setting the price yourself
from the aggregate numbers only, and compare efficiency. You never see individual
schedules — neither did Hayek's planner.

**What's deliberately not built:** a production chain (manufacturers buying an
input and selling a finished good), which is the most vivid version of the tin
story and a much larger change. Also note the one-standing-offer rule means one
person acts at a time; with two goods there are two books, but a class of 20 may
still want a fuller order book for this particular round.

## Supply & demand (instructor only)

A second chart on the instructor's dashboard draws the round's aggregate step
curves: **supply** is every producer cost sorted ascending, **demand** every
consumer value sorted descending, with the crossing marked as `CE q=N` and a
dashed drop-line. Any price controls you've set are drawn across it, so you can
see at a glance whether a ceiling cuts below the crossing.

Its own picker chooses the round. Past rounds plot the schedules **as they were
dealt** — archived alongside the offer events — so the curves stay truthful even
after schedules re-roll. Price controls are drawn only on the live round, never
back-dated onto an archived one. Hovering a quantity gives the supply cost and
demand value for that unit.

The curves appear the moment a round is **dealt**, before the market opens —
which is the point: it's the panel to set floors and ceilings against.

## Roster paging

Eight students per page, with `‹ Prev` / `Next ›` and a `9–16 of 20` counter;
the pager hides itself below nine students. The page index clamps when students
disconnect, so it can't strand you on an empty page.

## Interruptions

Neither a closed teacher tab nor a student refresh loses the session.

**Teacher.** Session state autosaves to the hosting browser. Reopen the page and
a *Resume your session* card appears with the code, round and headcount; resuming
re-registers the **same code**, so nothing on the students' side changes. The
market comes back **frozen** with whatever time was left, so a stale deadline
can't fire the instant you're back — unfreeze when the room is ready. *Discard
it* clears the save.

**Student.** The name is the rejoin token: type the **same name** and you land
back in your seat with your role, schedule, units already traded and running
total intact — and any standing offer you'd posted still belongs to you. Names
are matched case- and whitespace-insensitively, which does mean two students
typing the same name share one seat. Tell the class to pick distinct names.

## How multiple terminals talk to each other

GitHub Pages serves static files only, so **the instructor's browser tab is the
server**, the same pattern as `classroom-market-sim`:

- The teacher clicks *Create session* and gets a 4-letter code; that tab
  registers with the free PeerJS broker as `csim-template-<CODE>`.
- Each student opens the same URL, enters the code and a name, and their tab
  opens a WebRTC data channel straight to the teacher's tab.
- All rules run host-side. Students send intents (`OFFER`, `BUY`); the host
  validates them against its own state and fans out a per-student snapshot from
  `studentView()`. Nothing a student sends is trusted.
- Session state autosaves to the teacher's `localStorage`.

Requirements: internet for everyone, and a network that permits WebRTC.
**Keep the teacher tab open — it is the server.** Change `PEER_PREFIX` in
`net.js` per deployment so two classes can't collide on a code.

## Files

| File | Role |
|---|---|
| `index.html` | Three views: landing, instructor dashboard, student dashboard |
| `style.css` | custom-green tokens + components |
| `state.js` | State shape, schedules, surplus, equilibrium, per-student view filter |
| `net.js` | PeerJS transport: host/join, envelope, broadcast. No rules. |
| `chart.js` | The offer chart (plot + table view + hover) |
| `ui.js` | Pure render functions |
| `app.js` | Wiring **and the market rules** — offers, purchases, phases, scoring |

## Verified

Run live across multiple terminals: role balancing; the undercut rule and its
rejection message; the displaced-seller notice; whole-dollar rejection;
**price-floor and price-ceiling rejection sent raw over the wire**, bypassing the
client-side hint, to confirm the host is the one enforcing them; the
deal→open→close flow with schedules visible to students and CE numbers visible to
the instructor while the market is still shut; execution against the right units;
book clearing; round scoring into session totals; the
market-closed lockout on the student side; and a full **host-restart drill** —
teacher tab killed mid-round, resumed on the same code, student rejoined by name,
and the offer they had posted *before* the restart then traded correctly against
their own unit.

Verified this round: two-good books and shared capacity (a buyer took 2 tin +
2 copper; the fifth purchase was refused); the **silent shock** (tin CE moved
$11→$13 and quantity 16→12 while copper was untouched, and nothing entered the
students' feed); fullscreen (plot height 250→470 and back, on both charts);
curve presets reaching the dealt schedules (supply spanning 2–26 under *Inelastic
supply*); *keep schedules* holding a second deal identical; and the single-good
default still clean with every good-picker hidden.

Two bugs surfaced and were fixed: with *keep schedules* on, turning two goods on
left copper undealt, and a new curve shape never took effect. Both now force a
re-deal.

The externality is real money and the ledger balances: with 20 students and tin
at −$2/person, a single trade debited each of the **18 bystanders** exactly $2,
charged the buyer and seller **nothing**, recorded −$36 against the seller's
*caused* figure, and the sum of everyone's *borne* equalled the social total
exactly. At close, the seller's total rose by their full +$7 gain while a
bystander who traded nothing fell $2.

Student inputs no longer lose focus: focus, typed value, caret position **and
the DOM node itself** survive repeated render passes, while the ask price,
seller name and hint still update in place around them.

Earlier externality checks, per good and in both directions: tin at −$6 gave private
q=23 vs social q=11 ("will over-trade"), tin at +$5 gave q=23 vs 29 ("will
under-trade"), and tin +$5 alongside copper −$4 tracked independently with a
dashed social-cost curve on each. The Efficiency tile relabels to *Social
efficiency* and reports the spillover total. On the student side, with tin at
−$6 and copper at +$2, a producer who sold 2 tin and 1 copper showed **+$20
private profit** and **−$10 put onto the class** — the two numbers side by side,
and the spillover provably absent from the profit.

## Curve shape

Schedules are no longer drawn independently per student — that made every
round's aggregate curve identical at classroom scale. Instead the instructor
describes the **aggregate** curve and it's dealt out: supply steps from
*Supply starts at* to *Supply ends at* across all producer units, demand from
*Demand starts at* down to *Demand ends at*, each with ±jitter, then shuffled
among students and sorted within each schedule. A wider start-to-end spread is a
steeper, less elastic curve.

Presets cover the usual teaching cases: symmetric, inelastic/elastic supply,
inelastic/elastic demand, and surplus tilted to buyers or to sellers. Shape
applies at the **next deal** — and changing it overrides *keep schedules*, since
otherwise the new shape would never reach anyone.

## Fullscreen

Every chart card has a `⤢` button. Fullscreen uses the browser's own API, and
the chart redraws into the space rather than scaling a bitmap: the plot grows
taller and the offer columns widen. Escape returns it. Intended for the debrief,
when the offer chart or the S&D crossing is the only thing on the projector.

## Known gaps

- **Offers below cost / purchases above value are allowed.** The hint text warns
  ("buying at $12 loses $3") but nothing blocks a losing trade — deliberate, so
  the mistake is discussable, but flip it if your class needs guardrails.
- **No offer expiry.** The standing offer lives until it is undercut, bought, or
  the market closes.
- **Re-rolling schedules mid-round discards that round's offers** without
  archiving them — a re-roll is a restart, not a new round.
- Per-student round history is recorded but not yet plotted; the all-rounds
  chart shows market prices, not individual profit paths.
- **The two-good CE is indicative, not exact.** Capacity is shared across goods,
  so each good's crossing is computed in isolation; efficiency sums the two.
  Fine for teaching, wrong if you need the exact constrained optimum.
- **No production chain**, so the shock propagates one step, not through
  intermediaries who never learn the cause.
