/* Session state — the single source of truth for both dashboards.
 *
 * The instructor tab owns the authoritative copy. Students hold a *view* of it:
 * public market state plus their own schedules. A student never receives
 * another student's costs or values.
 *
 * Market rules:
 *   - Half the class produces, half consumes.
 *   - Only producers post offers; only ONE offer stands per good at a time, and
 *     a new offer must undercut it. Consumers accept, they never bid.
 *   - Whole dollars only. Optional price floor and ceiling.
 *   - Optionally TWO goods, sharing one capacity per student — which is what
 *     makes substitution, and so the Hayekian signal, visible.
 */
"use strict";

const SIM = { title: "Double Auction" };

const ROLE = { PRODUCER: "producer", CONSUMER: "consumer" };

/** Good keys are stable; names are what the dashboards print. */
const GOOD_NAMES = { tin: "Tin", copper: "Copper" };

const DEFAULT_PARAMS = {
  totalRounds: 8,
  roundLengthSec: 300,
  mode: "auto",
  unitsPerPlayer: 4,      // total units a student may trade, across all goods
  priceFloor: null,
  priceCeiling: null,

  // Market structure
  twoGoods: false,        // second good unlocks substitution
  keepSchedules: false,   // hold schedules fixed round to round (needed for shocks)

  // Curve shape — aggregate supply runs supplyLow→supplyHigh across all units,
  // demand runs demandHigh→demandLow. Wider spread = steeper = less elastic.
  supplyLow: 4,
  supplyHigh: 16,
  demandHigh: 16,
  demandLow: 4,
  noise: 1,               // ± jitter in dollars, so curves aren't perfect lines

  // Per-unit spillover, by good, charged to EVERY OTHER student — the two
  // parties to the trade are exempt. Negative = external cost (pollution),
  // positive = external benefit. Real money: it moves other people's balances.
  // The traders keep their whole gain, which is exactly the tension.
  externality: { tin: 0, copper: 0 },
};

/** Named starting points for the shapes an intro course actually teaches. */
const CURVE_PRESETS = {
  symmetric:    { label: "Symmetric",          supplyLow: 4,  supplyHigh: 16, demandHigh: 16, demandLow: 4 },
  inelasticSup: { label: "Inelastic supply",   supplyLow: 2,  supplyHigh: 26, demandHigh: 16, demandLow: 4 },
  elasticSup:   { label: "Elastic supply",     supplyLow: 9,  supplyHigh: 12, demandHigh: 18, demandLow: 2 },
  inelasticDem: { label: "Inelastic demand",   supplyLow: 4,  supplyHigh: 16, demandHigh: 28, demandLow: 2 },
  elasticDem:   { label: "Elastic demand",     supplyLow: 2,  supplyHigh: 18, demandHigh: 12, demandLow: 9 },
  buyersGain:   { label: "Surplus to buyers",  supplyLow: 3,  supplyHigh: 11, demandHigh: 22, demandLow: 6 },
  sellersGain:  { label: "Surplus to sellers", supplyLow: 8,  supplyHigh: 20, demandHigh: 24, demandLow: 10 },
};

const PHASE = {
  LOBBY: "lobby",
  READY: "ready",     // schedules dealt and visible; market not yet open
  OPEN: "open",
  PAUSED: "paused",
  BETWEEN: "between",
  DONE: "done",
};

/* ---------- construction ---------- */

function activeGoods(state) {
  return state.params.twoGoods ? ["tin", "copper"] : ["tin"];
}

function goodName(key) { return GOOD_NAMES[key] || key; }

function newSessionState(code) {
  return {
    code,
    phase: PHASE.LOBBY,
    round: 0,
    endsAt: null,
    params: { ...DEFAULT_PARAMS },
    students: {},
    log: [],
    market: newMarket(["tin"]),
    rounds: [],
    shocks: [],             // instructor-visible record of what was shocked
  };
}

/** One book per good, two-sided: the best sell offer and the best buy offer
 *  rest against each other. The invariant everywhere below is that a resting
 *  bid is always strictly under a resting ask — the moment they touch, they
 *  trade and the book clears. */
function newMarket(goods) {
  const books = {};
  goods.forEach((g) => { books[g] = { ask: null, bid: null, events: [], seq: 0 }; });
  return { books, trades: [] };
}

/* A killed browser tab often never fires a WebRTC close event, so presence is
 * judged on the heartbeat instead: three missed PINGs and you are gone. */
const STALE_MS = 16000;

/** Mark anyone who has stopped heartbeating. Returns true if anything changed,
 *  so the caller only re-broadcasts when presence actually moved. */
function sweepStale(state) {
  const cutoff = Date.now() - STALE_MS;
  let changed = false;
  studentList(state).forEach((s) => {
    if (s.connected && (s.lastSeen || 0) < cutoff) {
      s.connected = false;
      pushLog(state, `${s.name} dropped out of contact`);
      changed = true;
    }
  });
  return changed;
}

function newStudent(id, name, role) {
  return {
    id, name, role,
    connected: true,
    lastSeen: Date.now(),   // refreshed by the PING heartbeat
    units: {},              // good -> [{ n, value, price }]
    borne: 0,               // $ charged to them this round by OTHER people's
                            // trades. Real money — it lands in their round net.
    caused: 0,              // $ their own trades put on everyone else. Shown to
                            // them, never charged to them. The whole point.
    totalProfit: 0,
    lastAction: null,
    history: [],
  };
}

/* ---------- roles ---------- */

function findByName(state, name) {
  const key = name.trim().toLowerCase();
  return studentList(state).find((s) => s.name.trim().toLowerCase() === key) || null;
}

function reseat(state, student, newId) {
  const oldId = student.id;
  if (oldId === newId) return;
  delete state.students[oldId];
  student.id = newId;
  state.students[newId] = student;

  eachBook(state, (book) => {
    if (book.ask && book.ask.sellerId === oldId) book.ask.sellerId = newId;
    if (book.bid && book.bid.buyerId === oldId) book.bid.buyerId = newId;
    book.events.forEach((e) => { if (e.byId === oldId) e.byId = newId; });
  });
  state.market.trades.forEach((t) => {
    if (t.sellerId === oldId) t.sellerId = newId;
    if (t.buyerId === oldId) t.buyerId = newId;
  });
}

function eachBook(state, fn) {
  Object.keys(state.market.books).forEach((g) => fn(state.market.books[g], g));
}

function nextRole(state) {
  const list = studentList(state);
  const producers = list.filter((s) => s.role === ROLE.PRODUCER).length;
  return producers * 2 <= list.length ? ROLE.PRODUCER : ROLE.CONSUMER;
}

/* ---------- schedule generation ----------
 * Schedules are dealt off an aggregate ladder rather than drawn independently,
 * so the class-level curves have the shape the instructor asked for. Drawing
 * each student independently from one range makes every round's aggregate curve
 * identical at classroom scale — which defeats shocks and comparisons.
 */

/** n prices stepping from `a` to `b`, jittered, whole dollars, clamped above 1. */
function ladder(a, b, n, noise) {
  if (n <= 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const jitter = noise ? (Math.random() * 2 - 1) * noise : 0;
    out.push(Math.max(1, Math.round(a + (b - a) * t + jitter)));
  }
  return out;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deal one good's ladder across one side of the class. */
function dealSide(members, good, prices, ascending) {
  const pool = shuffled(prices);
  members.forEach((s, i) => {
    const mine = pool.slice(i * s.units.__per, (i + 1) * s.units.__per);
    mine.sort((x, y) => (ascending ? x - y : y - x));
    s.units[good] = mine.map((value, k) => ({ n: k + 1, value, price: null }));
  });
}

function rollAllSchedules(state) {
  const p = state.params;
  const goods = activeGoods(state);
  const list = studentList(state);
  const producers = list.filter((s) => s.role === ROLE.PRODUCER);
  const consumers = list.filter((s) => s.role === ROLE.CONSUMER);

  list.forEach((s) => {
    s.units = { __per: p.unitsPerPlayer };
    s.lastAction = null;
    s.borne = 0;
    s.caused = 0;
  });

  goods.forEach((g, gi) => {
    // The second good sits a little lower so the two aren't interchangeable.
    const skew = gi === 0 ? 0 : -2;
    dealSide(producers, g, ladder(p.supplyLow, p.supplyHigh, producers.length * p.unitsPerPlayer, p.noise), true);
    dealSide(consumers, g, ladder(p.demandHigh + skew, p.demandLow + skew, consumers.length * p.unitsPerPlayer, p.noise), false);
  });
  list.forEach((s) => { delete s.units.__per; });
}

/** Keep values, clear what was traded — for rounds that hold schedules fixed. */
function resetUnitPrices(state) {
  studentList(state).forEach((s) => {
    Object.keys(s.units).forEach((g) => s.units[g].forEach((u) => { u.price = null; }));
    s.lastAction = null;
    s.borne = 0;
    s.caused = 0;
  });
}

function hasSchedules(state) {
  return studentList(state).some((s) => Object.keys(s.units).length > 0);
}

/** Do the schedules on hand still match the goods in play? "Keep schedules"
 *  must not survive a change of goods — it would leave the new good undealt. */
function schedulesFit(state) {
  const want = activeGoods(state).slice().sort().join(",");
  const list = studentList(state);
  if (!list.length) return false;
  return list.every((s) => Object.keys(s.units).sort().join(",") === want
    && activeGoods(state).every((g) => (s.units[g] || []).length === state.params.unitsPerPlayer));
}

/** A silent cost shock: the named share of producers find `amount` added to
 *  every untraded unit of `good`. Nobody is told unless the instructor says so. */
function applyShock(state, good, amount, share) {
  const producers = studentList(state).filter((s) => s.role === ROLE.PRODUCER && s.units[good]);
  const hit = shuffled(producers).slice(0, Math.max(1, Math.round(producers.length * share)));
  hit.forEach((s) => {
    s.units[good].forEach((u) => { if (u.price === null) u.value = Math.max(1, u.value + amount); });
  });
  state.shocks.push({ round: state.round, good, amount, count: hit.length, ts: Date.now() });
  return hit.map((s) => s.name);
}

/* ---------- units & surplus ---------- */

function unitsOf(student, good) { return student.units[good] || []; }

function nextUnit(student, good) {
  return unitsOf(student, good).find((u) => u.price === null) || null;
}

function unitsTraded(student) {
  return Object.keys(student.units)
    .reduce((sum, g) => sum + student.units[g].filter((u) => u.price !== null).length, 0);
}

function capacityLeft(student, params) {
  return params.unitsPerPlayer - unitsTraded(student);
}

function unitProfit(student, unit) {
  if (unit.price === null) return null;
  return student.role === ROLE.PRODUCER ? unit.price - unit.value : unit.value - unit.price;
}

function roundProfit(student) {
  return Object.keys(student.units).reduce((sum, g) =>
    sum + student.units[g].reduce((s2, u) => s2 + (unitProfit(student, u) || 0), 0), 0);
}

/* ---------- equilibrium ---------- */

/** Aggregate steps per good, anonymised. Capacity is shared across goods, so
 *  a two-good CE is indicative rather than exact — flagged in the UI. */
function scheduleSnapshot(state, good) {
  const g = good || activeGoods(state)[0];
  const costs = [];
  const values = [];
  studentList(state).forEach((s) => {
    unitsOf(s, g).forEach((u) => (s.role === ROLE.PRODUCER ? costs : values).push(u.value));
  });
  costs.sort((a, b) => a - b);
  values.sort((a, b) => b - a);
  return { costs, values };
}

function equilibrium(state, good) {
  return equilibriumOf(scheduleSnapshot(state, good));
}

function equilibriumOf({ costs, values }) {
  let q = 0;
  let maxSurplus = 0;
  while (q < costs.length && q < values.length && values[q] >= costs[q]) {
    maxSurplus += values[q] - costs[q];
    q += 1;
  }
  if (q === 0) return { quantity: 0, priceLo: null, priceHi: null, maxSurplus: 0 };
  const lo = Math.max(costs[q - 1], values[q] ?? -Infinity);
  const hi = Math.min(values[q - 1], costs[q] ?? Infinity);
  return { quantity: q, priceLo: lo, priceHi: hi, maxSurplus };
}

/** Where the market *should* stop once the spillover is counted. A unit is
 *  worth trading socially when value − cost + externality ≥ 0. */
function socialOptimumOf({ costs, values }, e) {
  if (!e) return { ...equilibriumOf({ costs, values }), external: 0 };
  let q = 0;
  let surplus = 0;
  while (q < costs.length && q < values.length && values[q] - costs[q] + e >= 0) {
    surplus += values[q] - costs[q] + e;
    q += 1;
  }
  return { quantity: q, maxSurplus: surplus };
}

function externalityOf(state, good) {
  const e = state.params.externality || {};
  return Number(e[good]) || 0;
}

/** How many people a single trade actually hits: everyone except the buyer
 *  and the seller. Scales the per-person amount up to the social one. */
function bystanderCount(state) {
  return Math.max(0, studentList(state).length - 2);
}

/** What one unit of `good` does to total welfare beyond the traders. */
function aggregateExternality(state, good) {
  return externalityOf(state, good) * bystanderCount(state);
}

/** Total spillover inflicted this round, summed over everyone it landed on. */
function externalTotal(state) {
  return state.market.trades.reduce(
    (sum, t) => sum + aggregateExternality(state, t.good), 0);
}

/** Private trading surplus plus the money others actually took from them. */
function roundNet(student) {
  return roundProfit(student) + (student.borne || 0);
}

function anyExternality(state) {
  return activeGoods(state).some((g) => externalityOf(state, g) !== 0);
}

function tradesOf(state, good) {
  return good ? state.market.trades.filter((t) => t.good === good) : state.market.trades;
}

/* ---------- efficiency ----------
 * ONE measure, always on the social basis: realized surplus including the
 * spillover, over the most society could have got. With no externality set the
 * aggregate spillover is 0, socialOptimumOf falls through to the private
 * equilibrium, and this is exactly the old private number — so there is no
 * second metric and no label that changes underfoot.
 *
 * Measuring on the private basis was the bug: a market that trades every
 * privately profitable unit scores 100% no matter how much damage those trades
 * do to everyone else, which is the one thing the externality lesson needs the
 * scoreboard to show.
 */

/** Score one good: realized social surplus, and the most society could have
 *  had. `aggExt` is the spillover per unit summed over the bystanders it
 *  actually lands on. Null when there is no market to score. */
function scoreGood(schedule, trades, aggExt) {
  if (!schedule || !schedule.costs.length || !schedule.values.length) return null;
  return {
    surplus: trades.reduce((sum, t) => sum + (t.value - t.cost) + aggExt, 0),
    max: socialOptimumOf(schedule, aggExt).maxSurplus,
  };
}

function addScore(a, b) {
  if (!b) return a;
  return a ? { surplus: a.surplus + b.surplus, max: a.max + b.max } : b;
}

/** A score as a ratio. A big enough external cost makes no unit worth trading;
 *  then nothing is the whole of what was available, and trading nothing is
 *  efficient while trading anything is not. */
function ratioOf(score) {
  if (!score) return null;
  if (score.max <= 0) return score.surplus >= 0 ? 1 : 0;
  return score.surplus / score.max;
}

/** Realized and maximum surplus across every good in play. */
function surplusScore(state) {
  return activeGoods(state).reduce((acc, g) => addScore(acc,
    scoreGood(scheduleSnapshot(state, g), tradesOf(state, g), aggregateExternality(state, g))), null);
}

/** The header tile's number. */
function efficiency(state) {
  return ratioOf(surplusScore(state));
}

/** The aggregate spillover an archived round was actually played under.
 *  Rounds saved before this was recorded report 0 rather than back-dating
 *  today's setting onto them — the same rule the S&D chart uses for controls. */
function archivedAggExt(record, good) {
  return (Number((record.externality || {})[good]) || 0) * (record.bystanders || 0);
}

/** Score an archived round against the schedules as they were dealt. Pass a
 *  good to score just that book, which is what the per-good S&D chart wants. */
function roundScore(record, good) {
  const goods = good ? [good] : Object.keys(record.schedules || {});
  return goods.reduce((acc, g) => addScore(acc, scoreGood(
    (record.schedules || {})[g],
    (record.trades || []).filter((t) => t.good === g),
    archivedAggExt(record, g))), null);
}

/** Efficiency for display. Floored at 0%: a market that destroyed value
 *  captured none of the gains available, and the raw ratio's magnitude is
 *  unstable when the social optimum sits near zero. The dollar figures beside
 *  it carry how far past zero it actually went. */
function efficiencyPct(x) {
  return x == null ? "—" : `${Math.max(0, Math.round(x * 100))}%`;
}

function avgTradePrice(state, good) {
  const t = tradesOf(state, good);
  if (!t.length) return null;
  return t.reduce((sum, x) => sum + x.price, 0) / t.length;
}

/* ---------- derived ---------- */

function studentList(state) {
  return Object.values(state.students).sort((a, b) => a.name.localeCompare(b.name));
}

function connectedCount(state) {
  return studentList(state).filter((s) => s.connected).length;
}

function isRoundOpen(state) { return state.phase === PHASE.OPEN; }

function secondsLeft(state) {
  if (!state.endsAt) return null;
  return Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
}

function formatClock(secs) {
  if (secs == null) return "--:--";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function money(n) {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2).replace(/\.00$/, "")}`;
}

/* ---------- the slice a student may see ---------- */

/** Orders are public — who posted, at what price, on which side. Only the
 *  poster's peer id is stripped. Private values never appear here at all. */
function publicEvents(events) {
  return events.map((e) => e.kind === "trade"
    ? { kind: "trade", price: e.price, sellerName: e.sellerName, buyerName: e.buyerName, ts: e.ts }
    : { kind: "offer", side: e.side || "sell", price: e.price, byName: e.byName,
        ts: e.ts, status: e.status });
}

function publicBooks(market) {
  const out = {};
  Object.keys(market.books).forEach((g) => {
    out[g] = {
      ask: market.books[g].ask,
      bid: market.books[g].bid,
      seq: market.books[g].seq,
      events: publicEvents(market.books[g].events),
    };
  });
  return out;
}

function publicMarket(state) {
  return {
    books: publicBooks(state.market),
    rounds: state.rounds.map((r) => ({
      round: r.round,
      books: Object.keys(r.books).reduce((acc, g) => {
        acc[g] = { events: publicEvents(r.books[g].events) };
        return acc;
      }, {}),
    })),
    tradeCount: state.market.trades.length,
  };
}

function studentView(state, id) {
  const me = state.students[id];
  // Students DO see the spillover. The lesson isn't that they're ignorant of
  // it — it's that knowing about it doesn't change their private incentive,
  // because it never touches their own payoff.
  return {
    code: state.code,
    phase: state.phase,
    round: state.round,
    endsAt: state.endsAt,
    params: state.params,
    goods: activeGoods(state),
    peerCount: studentList(state).length,
    market: publicMarket(state),
    me: me ? { ...me } : null,
    messages: state.log.filter((e) => e.toStudents),
  };
}

/* ---------- archive ---------- */

function archiveRound(state) {
  if (!state.round) return;
  state.rounds = state.rounds.filter((r) => r.round !== state.round);
  const schedules = {};
  Object.keys(state.market.books).forEach((g) => { schedules[g] = scheduleSnapshot(state, g); });
  state.rounds.push({
    round: state.round,
    books: state.market.books,
    trades: state.market.trades,
    schedules,
    // Scored later against the spillover this round was actually played under,
    // not whatever the instructor sets next.
    externality: { ...(state.params.externality || {}) },
    bystanders: bystanderCount(state),
    shocked: state.shocks.some((s) => s.round === state.round),
  });
  state.rounds.sort((a, b) => a.round - b.round);
}

/* ---------- log ---------- */

function pushLog(state, text, opts = {}) {
  state.log.unshift({
    ts: Date.now(),
    text,
    toStudents: !!opts.toStudents,
  });
  state.log.length = Math.min(state.log.length, 200);
}

/* ---------- persistence ---------- */

const SAVE_KEY = "classroom-sim-host";

function saveSession(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* quota */ }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}
