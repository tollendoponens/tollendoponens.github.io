# Classroom double auction

A live, multi-computer classroom market. The instructor opens and closes the
market; **both sides post prices, and either side can accept the other's**.
Everyone watches the same order chart. Runs entirely on GitHub Pages — no
backend.

This is **step one** of a larger simulation, not the finished thing.

## Preview the dashboards without a class

Fake mid-round market, no networking:

```bash
python -m http.server 8000
```

- Instructor: <http://localhost:8000/?preview=teacher>
- Producer: <http://localhost:8000/?preview=student>
- Consumer: <http://localhost:8000/?preview=student&role=consumer>
- Projected display: <http://localhost:8000/?preview=screen>

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

On the instructor's side it moves the scoreboard, without moving the label:
efficiency **always** counts the spillover (see *Efficiency* below), so a
market that over-trades a polluting good scores badly rather than scoring 100%
for trading every privately profitable unit. The briefing gains a **social
optimum** quantity beside the private one, and the S&D chart grows a dashed
**social cost** curve — private cost minus the externality — with the social
quantity marked. A negative spillover puts it above supply and the market
over-trades; a positive one puts it below and the market under-trades.

**Price controls.** The instructor can set a floor, a ceiling, both, or neither
(blank = none); they apply immediately, at any point in a round. Orders outside
the limits are refused **on the host**, on **both sides** — and a resting order
that a newly applied control outlaws is withdrawn rather than left sitting there
illegally, again on both sides. A ceiling typically kills asks and a floor
typically kills bids, but each is checked against both. A floor above a ceiling
is refused outright — nothing would be legal. Students see the active limits
beside the book and as dashed lines on the chart.

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

**Trading — a two-sided book.** Producers post **sell offers** and consumers post
**buy offers**, into the same book. Each side keeps **only its best order
resting**: a new sell offer must strictly undercut the standing one, a new buy
offer must strictly beat it. Whoever is displaced is told who beat them and at
what price. **Prices are whole dollars only** — enforced on the host, not just in
the input.

**The two ways a trade happens** are the same event seen from either end:

1. **Accepting.** One click on *Buy Tin at $16* or *Sell Tin at $9* takes
   whatever is resting on the other side. Nobody has to type a number to say
   yes, which is what keeps a 20-person round moving.
2. **Crossing.** A posted price that meets the other side doesn't rest — it
   trades on the spot. A sell offer at or below the standing bid, or a buy offer
   at or above the standing ask, executes immediately.

Either way the trade executes at the **resting order's price**, not the
incoming one. Whoever committed to a number first sets the terms — so posting is
worth doing, rather than everyone waiting to accept. A buy offer of $18 that
crosses a resting $14 ask trades at **$14**, and the buyer keeps the difference.

Because any crossing pair trades at once, a resting bid is always strictly below
a resting ask; the spread is visible on both dashboards as the gap between the
two numbers. A trade **clears the whole book** — the chart starts a new column
and any price may open it again from either direction. An order still resting on
the far side is cancelled rather than executed, and its owner is told so.
Execution matches the seller's cheapest unsold unit against the buyer's highest
unbought unit, exactly as before.

**Profit.** Producer profit is `price − cost`; consumer surplus is
`value − price`. Both are computed per unit, totalled per round, and banked into
a session total when the market closes.

**The game total** sits in the student's top bar as `Game total +$42`, green
when they're up and red when they're down, and it is there in every phase — it
moves at each round close, not per trade. The round tile below it carries the
round's own figure and, when a spillover is running, its breakdown. Those used
to share one slot, which meant the running total disappeared for the whole of
any round that carried a spillover — exactly the rounds where students most
want to know where they stand. The instructor sees the same number for everyone
in the roster's **Total** column.

**Instructor benchmarks.** The header tiles show trades, average price, and
efficiency, with the competitive-equilibrium quantity and price band computed
from the aggregate schedules. That's the number the discussion after the round
is usually about. Students are not told it — see *Efficiency*.

## The projected display

A third view, for the front of the room. On the landing page, under *Put the
market on the screen*, type **just the code** — no name — and the tab attaches
as a read-only display.

It shows the **best bid and best ask per good** at 64px with the spread under
them, the **live order chart**, and a **scrolling log of every trade** (newest
first, so it never needs scrolling to stay current). Between rounds the book
hides and the chart and log stay up, which is the state you actually want while
discussing what just happened.

**It takes no seat.** A display is not a student: it gets no student record, no
schedule and no role, never appears in the roster, and — the one that would
quietly corrupt the economics — is **not counted among the bystanders an
externality is divided between**. Attaching or closing one changes no number in
the session and writes nothing to the feed.

**It cannot see private values.** The display is fed by `screenView()`, which is
built from public pieces only rather than by blanking fields out of
`studentView()` — so there is nothing to accidentally leave in. The host's own
trade records carry `cost` and `value`; `publicTrades()` strips both, and the
trade log shows only who traded with whom at what price. No schedules, no
per-student money, no totals.

The student dashboard **no longer carries the chart** — one shared picture at
the front of the room, rather than twenty small ones people read instead of
trading. Students keep their order book, their schedule and the instructor's
messages.

A projector that loses the host does not auto-reattach: reload and re-enter the
code, the same as a student rejoining.

## The order chart

The instructor dashboard and the projected display render the same chart:
**one column per trade**, now carrying
**both ladders**. Every order posted in the run-up to a trade is a dot in that
column: sell offers in blue walking *down*, buy offers in orange walking *up*,
since each must improve on the last. A column therefore reads as the two sides
closing on each other, and the dark dot is where they finally met — drawn in ink
at the execution price, the same marker the S&D chart uses for the crossing,
because that is what it is. The rightmost column is the trade in progress.

Blue is the sell side and orange the buy side on **both** charts, so supply
keeps the colour it wears on the S&D curves.

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
prices converge across the session in one picture. The instructor dashboard and
the projected display both get this control, and the display's archived rounds
go through the same private-value stripping as its live one.

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
story and a much larger change. Note also that only the **best** order rests per
side, so a class of 20 may still want more depth than one bid and one ask —
though with both sides now posting, twice as many people are acting at once as
before.

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

**That round's efficiency** is printed in the top-right of the plot and spelled
out in dollars underneath, so stepping the picker through the rounds reads as a
round-by-round scoreboard and not just a comparison of shapes. It is the
selected good's number, scored against the schedules as they were dealt — and,
like the price controls, an archived round is scored under the spillover it was
actually played under, never one set afterwards.

## Efficiency

**One measure, one label.** Efficiency is realized surplus *including the
spillover*, over the most society could have got:

```
efficiency = Σ (value − cost + externality) over trades
           ÷ Σ (value − cost + externality) over units worth trading socially
```

With no externality set the spillover term is zero and this is the ordinary
private number, so the tile never relabels itself and there is no second metric
to keep straight.

Measuring on the private basis was a bug worth naming, because it broke exactly
the lesson the externality exists to teach: a market that trades every privately
profitable unit scored **100%** no matter how much damage those trades did to
everyone else. It now scores the damage. Trading *to the social optimum* scores
100%; over-trading a polluting good and under-trading a beneficial one both
score below it.

Two edges are handled deliberately. A large enough external cost makes **no**
unit worth trading — the denominator is zero, and then trading nothing is
efficient (100%) while trading anything is not (0%). And the ratio is **floored
at 0%** for display: a market can destroy more value than the best case
creates, but the raw magnitude is unstable when the social optimum sits near
zero, so the tile reports 0% and the dollar figures beside it carry how far past
zero it went.

**Students never see it.** Efficiency is on the instructor's tile and the S&D
chart only; the round-close message tells the class how many trades happened and
nothing more. Broadcasting the score handed them the answer before the
discussion that's supposed to arrive at it.

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

**Presence is judged on the heartbeat, not on the close event.** A closed tab
frequently never fires WebRTC's `close`, so the roster used to show a student
as connected indefinitely after they walked away. Students ping every 5
seconds; the host sweeps once a second and anyone silent for **16 seconds**
(three missed beats) is marked dropped and logged. A ping arriving from someone
already marked dropped puts them straight back, logged the same way, without
needing a reload. `onDisconnect` still fires when it can — the sweep is the
backstop, not the replacement.

**Student.** The name is the rejoin token: type the **same name** and you land
back in your seat with your role, schedule, units already traded and running
total intact — and any order you'd left resting still belongs to you. Names
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
| `index.html` | Four views: landing, instructor dashboard, student dashboard, projected display |
| `style.css` | custom-green tokens + components |
| `state.js` | State shape, schedules, surplus, equilibrium, the student and display view filters |
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

The projected display was checked for the two things that would actually matter
in a room. **It leaks nothing**: the payload was scanned for `units`, `cost`,
`value`, `totalProfit`, `borne`/`caused`, `students`, `externality`, `me` and
`schedules` and carries none of them — the host's trade records hold `cost` and
`value`, the display's hold neither. **It takes no seat**: attaching one left
students at 20, connected at 19 and the externality's bystander count at 18, put
nothing in the roster, and closing it logged nothing. Routing was confirmed
per-peer — students received `state`, the display received `screen` and never
`state`. The trade log scrolls at 25 trades instead of growing its card, newest
first; the book, chart and log were checked open, between rounds, frozen with
price controls, and in the lobby; two goods render two books with their own
spreads; and no view overflows at 1920, 1440, 1280 or 900px.

One hazard was caught and fixed before it could bite: the projector's state
global was named `screen`, which shadows the built-in `window.screen` for every
script on the page. Renamed to `screenState`; `window.screen` verified intact.

The double auction was driven through the real host rules, on deterministic
schedules, not through the preview script. Both sides rest and both improvement
rules bite (a bid of 9 refused under a resting 10, a 12 accepted; an ask of 16
refused under a resting 15). A resting ask and bid coexist without touching
(ask 15 over bid 12). **Crossing pays the resting price in both directions**: an
ask of 11 into a bid of 12 traded at **12**, and a bid of 18 into an ask of 14
traded at **14**. Both one-click accepts execute, and the stale-`seq` guard
still refuses a click on an order that was replaced mid-click.

Price controls refuse on both sides and withdraw resting orders on both sides.
Crossing into a counterparty who has since spent their capacity withdraws that
order instead of trading. With two goods the books are independent (a copper
cross left the tin bid untouched) and capacity stays shared — a consumer was
capped at 4 units across both. The externality ledger balances identically
through all three execution paths: 8 bystanders debited $1 each, the two traders
charged nothing and each shown −$8 caused.

One bug surfaced and was fixed: the order that *executed* was being relabelled
`cleared` by the book-clearing pass that runs behind it, so the chart called a
completed trade a cancellation. The consumed side now comes off the book as it
executes; only genuinely cancelled survivors read `cleared`.

The stale-presence sweep was exercised against the real clock: a student silent
for 15 seconds stayed connected, 17 seconds flipped them to dropped and logged
it once, a second sweep reported no change (so it can't re-broadcast every
second), and a fresh ping restored them. Two simultaneous drops took the roster
from 20 to 18 connected with the right dots going grey. The game total was
checked positive, negative, zero and alongside a spillover, and the nav doesn't
overflow at 1280, 900, 600 or 375px.

The efficiency rewrite was checked against the real `state.js`, driven from the
preview harness rather than a live class. Holding the market at the **private**
equilibrium and sweeping the spillover, the old measure read 100% at every
setting; the new one reads 100% only with no externality and falls to 52%, 0%,
0% at −$0.25, −$0.50 and −$2 per person, and to 84% at **+$0.50**, where the
market under-trades instead. Trading *to the social optimum* scores 100% at
every setting, including the ones where the optimum is zero trades. Per-good
figures on the S&D chart sum to the tile exactly ($13 of $124 tin plus $1 of $81
copper against a $14-of-$205 tile), a spillover set mid-session moved the live
round without back-dating onto the two archived ones, and the round-close
message reaching students carries the trade count alone.

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

- **Losing trades are allowed** — selling below cost, buying above value.
  Deliberate, so the mistake is discussable, but flip it if your class needs
  guardrails. Students read their own schedule to see what a price is worth to
  them; the app doesn't warn them.
- **Only the best order rests per side.** There is no depth behind it, so a
  second-best bid is beaten rather than queued.
- **No order expiry.** A resting order lives until it is beaten, taken, cleared
  by a trade, or the market closes.
- **Re-rolling schedules mid-round discards that round's offers** without
  archiving them — a re-roll is a restart, not a new round.
- Per-student round history is recorded but not yet plotted; the all-rounds
  chart shows market prices, not individual profit paths.
- **The two-good CE is indicative, not exact.** Capacity is shared across goods,
  so each good's crossing is computed in isolation; efficiency sums the two.
  Fine for teaching, wrong if you need the exact constrained optimum.
- **No production chain**, so the shock propagates one step, not through
  intermediaries who never learn the cause.
