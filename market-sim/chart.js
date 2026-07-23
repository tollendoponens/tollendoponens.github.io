/* The offer chart — the one picture everyone in the room is looking at.
 *
 * Form: one column per trade. Every sell offer posted in the run-up to a
 * purchase is a dot in that trade's column, stacked by price — since each offer
 * must undercut the last, a column reads top-to-bottom as the bidding came down.
 * The dot at the foot of a column is the offer that traded (orange).
 *
 * The box is a fixed size. Columns are narrow and the plot scrolls sideways
 * rather than growing the card; nothing here may change the card's height.
 * Rounds are divided by a dashed rule, not by labels.
 *
 * Palette: dataviz categorical slots 1 and 2, validated all-pairs on the white
 * card surface — CVD ΔE 24.7 (protan), normal-vision ΔE 33.6, both ≥ 3:1 contrast.
 * Price floor/ceiling are drawn as annotation in ink, not as a third series.
 */
"use strict";

const SERIES = {
  offer: "#2a78d6",   // categorical slot 1 — blue
  trade: "#eb6834",   // categorical slot 2 — orange
};

const GEO = {
  height: 250,     // fixed, always
  colStep: 44,     // px per trade column — narrow on purpose
  padL: 46,
  padR: 20,
  padT: 24,        // room for price labels above the top dot
  padB: 18,
  minWidth: 320,
};

/** Which containers are showing the table instead of the plot. */
const chartMode = {};
/** Which round each container is showing: "current" | "all" | a round number. */
const chartRound = {};
/** Which good each container is showing (two-good mode only). */
const chartGood = {};
/** Signature of the options currently in each container's round picker. */
const chartPickerSig = {};

/** Charts grow into the space when their card is fullscreened for a debrief. */
function isFullscreen(el) {
  const fs = document.fullscreenElement;
  return !!(fs && el && fs.contains(el));
}

function chartHeight(el, base) {
  if (!isFullscreen(el)) return base;
  return Math.max(base, Math.round(window.innerHeight - 250));
}

function setChartGood(id, good) { chartGood[id] = good; }

function toggleChartMode(id) {
  chartMode[id] = chartMode[id] === "table" ? "chart" : "table";
}

function setChartRound(id, value) {
  chartRound[id] = value === "current" || value === "all" ? value : Number(value);
}

/** Group one round's event stream into one column per trade, plus the open one. */
function buildColumns(events) {
  const cols = [];
  let cur = { offers: [], trade: null };
  events.forEach((e) => {
    if (e.kind === "offer") {
      cur.offers.push(e);
    } else {
      cur.trade = e;
      cols.push(cur);
      cur = { offers: [], trade: null };
    }
  });
  if (cur.offers.length) cols.push(cur);
  return cols;
}

/** Every round the picker can offer, oldest first, live round last. */
function availableRounds(archive, currentRound) {
  const past = archive.map((r) => r.round);
  return currentRound && !past.includes(currentRound) ? past.concat(currentRound) : past;
}

/** Resolve the current selection into [{ round, events }], oldest first. */
function resolveSources(id, market, currentRound, archive, good) {
  const selection = chartRound[id] || "current";
  const evOf = (books) => (books && books[good] ? books[good].events : []);
  const past = archive.map((r) => ({ round: r.round, events: evOf(r.books) }));
  const live = { round: currentRound, events: evOf(market.books) };

  if (selection === "all") return past.concat(live.events.length ? [live] : []);
  if (selection === "current") return [live];
  const found = past.find((r) => r.round === selection);
  if (found) return [found];
  return selection === currentRound ? [live] : [];
}

/** opts: { market, round, archive, params, goods } */
function renderOfferChart(id, opts) {
  const el = document.getElementById(id);
  if (!el) return;
  const market = opts.market || { books: {} };
  const archive = opts.archive || [];
  const params = opts.params || {};
  const goods = opts.goods || ["tin"];
  if (!chartGood[id] || !goods.includes(chartGood[id])) chartGood[id] = goods[0];
  const good = chartGood[id];

  renderRoundPicker(id, archive, opts.round);
  renderGoodPicker(id, goods, good);
  const toggle = document.querySelector(`[data-chart-toggle="${id}"]`);
  if (toggle) toggle.textContent = chartMode[id] === "table" ? "Chart" : "Table";

  // Tag each column with the round it came from so dividers and tips can use it.
  const columns = [];
  resolveSources(id, market, opts.round, archive, good).forEach((src) => {
    buildColumns(src.events).forEach((c) => columns.push({ ...c, round: src.round }));
  });

  if (!columns.length) {
    const selection = chartRound[id] || "current";
    el.innerHTML = `<div class="mount">${
      selection === "current" || selection === "all"
        ? `No ${goodName(good).toLowerCase()} offers yet.`
        : `Round ${selection} had no ${goodName(good).toLowerCase()} offers.`
    }</div>`;
    return;
  }
  el.innerHTML = chartMode[id] === "table"
    ? tableView(columns)
    : plotView(columns, el, params);
  if (chartMode[id] !== "table") attachTips(el);
}

/** The good selector only exists when there are two goods to choose between. */
function renderGoodPicker(id, goods, current) {
  const sel = document.querySelector(`[data-chart-good="${id}"]`);
  if (!sel) return;
  sel.hidden = goods.length < 2;
  if (goods.length < 2) return;
  const sig = goods.join(",");
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = goods.map((g) => `<option value="${g}">${goodName(g)}</option>`).join("");
  }
  if (sel.value !== current) sel.value = current;
}

/** Rebuild the round <select> only when the option set actually changes,
 *  so a 1Hz repaint can't slam a dropdown shut mid-choice. */
function renderRoundPicker(id, archive, currentRound) {
  const sel = document.querySelector(`[data-chart-round="${id}"]`);
  if (!sel) return;
  const rounds = availableRounds(archive, currentRound);
  const sig = `${rounds.join(",")}|${currentRound}`;
  if (chartPickerSig[id] !== sig) {
    chartPickerSig[id] = sig;
    const opts = rounds.map((r) => r === currentRound
      ? `<option value="current">Round ${r} · live</option>`
      : `<option value="${r}">Round ${r}</option>`);
    if (rounds.length > 1) opts.push(`<option value="all">All rounds</option>`);
    sel.innerHTML = opts.join("") || `<option value="current">Round —</option>`;
  }
  const want = chartRound[id] || "current";
  if (sel.value !== String(want)) sel.value = String(want);
}

/* ---------------- plot ---------------- */

function plotView(columns, el, params) {
  const prices = [];
  columns.forEach((c) => c.offers.forEach((o) => prices.push(o.price)));

  // A binding price control has to be on screen even if nobody offered near it.
  const floor = numOrNull(params.priceFloor);
  const ceiling = numOrNull(params.priceCeiling);
  const span = prices.concat([floor, ceiling].filter((v) => v !== null));

  let lo = Math.min(...span);
  let hi = Math.max(...span);
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;

  const height = chartHeight(el, GEO.height);
  const full = isFullscreen(el);
  const plotH = height - GEO.padT - GEO.padB;
  const y = (p) => GEO.padT + (1 - (p - lo) / (hi - lo)) * plotH;
  const baseY = height - GEO.padB;

  const avail = Math.max(el.clientWidth || 0, GEO.minWidth);
  const needed = GEO.padL + GEO.padR + columns.length * (full ? GEO.colStep * 2 : GEO.colStep);
  const W = Math.max(avail, needed);
  const step = (W - GEO.padL - GEO.padR) / columns.length;
  const x = (i) => GEO.padL + i * step + step / 2;

  // Gridlines — hairline, solid, recessive, on round numbers.
  const grid = niceTicks(lo, hi, 4).map((t) => `
    <line x1="${GEO.padL - 8}" x2="${W - 6}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"
          stroke="var(--border)" stroke-width="1"/>
    <text x="${GEO.padL - 12}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end"
          font-size="10" fill="var(--text-dim)" style="font-variant-numeric:tabular-nums">${money(t)}</text>
  `).join("");

  // Dashed rule wherever the round changes.
  const dividers = columns.slice(1).map((col, k) => {
    if (col.round === columns[k].round) return "";
    const sx = (GEO.padL + (k + 1) * step).toFixed(1);
    return `<line x1="${sx}" x2="${sx}" y1="${GEO.padT - 12}" y2="${baseY}"
              stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="4 4"/>`;
  }).join("");

  // Price controls: annotation in ink, never a series color.
  const controls = [
    ceiling !== null ? { p: ceiling, label: `Ceiling ${money(ceiling)}` } : null,
    floor !== null ? { p: floor, label: `Floor ${money(floor)}` } : null,
  ].filter(Boolean).map((c) => `
    <line x1="${GEO.padL - 8}" x2="${W - 6}" y1="${y(c.p).toFixed(1)}" y2="${y(c.p).toFixed(1)}"
          stroke="var(--text)" stroke-width="1" stroke-dasharray="6 3" opacity="0.55"/>
    <text x="${GEO.padL - 4}" y="${(y(c.p) - 5).toFixed(1)}" font-size="10" font-weight="700"
          fill="var(--text-dim)">${c.label}</text>`).join("");

  const body = columns.map((col, i) => {
    const cx = x(i);
    const traded = !!col.trade;

    const path = col.offers.length > 1
      ? `<polyline points="${col.offers.map((o) => `${cx.toFixed(1)},${y(o.price).toFixed(1)}`).join(" ")}"
           fill="none" stroke="${SERIES.offer}" stroke-width="2"
           stroke-linejoin="round" stroke-linecap="round"/>`
      : "";

    const dots = col.offers.map((o, k) => {
      const isTrade = traded && k === col.offers.length - 1;
      const tip = isTrade
        ? `Round ${col.round} · traded ${money(o.price)} · ${o.sellerName} → ${col.trade.buyerName}`
        : `Round ${col.round} · offer ${money(o.price)} · ${o.sellerName}`
          + (o.status === "beaten" ? " (undercut)" : "");
      const cy = y(o.price).toFixed(1);
      // 2px surface ring keeps overlapping dots legible; it is also the hit target.
      return `
        <circle cx="${cx.toFixed(1)}" cy="${cy}" r="${isTrade ? 6 : 4.5}" fill="var(--bg)"/>
        <circle cx="${cx.toFixed(1)}" cy="${cy}" r="${isTrade ? 4.5 : 3}"
                fill="${isTrade ? SERIES.trade : SERIES.offer}"/>
        <circle cx="${cx.toFixed(1)}" cy="${cy}" r="10" fill="transparent"
                data-tip="${esc(tip)}" style="cursor:pointer"/>`;
    }).join("");

    // No direct labels: the y-axis, the hover tip and the table carry values.
    return path + dots;
  }).join("");

  const trades = columns.filter((c) => c.trade).length;
  const rounds = [...new Set(columns.map((c) => c.round))];
  const summary = `${columns.length} columns, one per trade`
    + (rounds.length > 1 ? `, across rounds ${rounds[0]} to ${rounds[rounds.length - 1]}` : "")
    + `: ${prices.length} sell offers, ${trades} trades, `
    + `prices ${money(Math.min(...prices))} to ${money(Math.max(...prices))}.`;

  return `
    <div class="chart-legend">
      <span class="legend-item"><span class="dot" style="background:${SERIES.offer}"></span>Sell offer</span>
      <span class="legend-item"><span class="dot" style="background:${SERIES.trade}"></span>Offer that traded</span>
      ${rounds.length > 1 ? '<span class="legend-item"><span class="legend-dash"></span>Round divider</span>' : ""}
    </div>
    <div class="chart-scroll">
      <svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"
           role="img" aria-label="${esc(summary)}">
        ${grid}
        <line x1="${GEO.padL - 8}" x2="${W - 6}" y1="${baseY}" y2="${baseY}"
              stroke="var(--border)" stroke-width="1"/>
        ${dividers}${controls}${body}
      </svg>
    </div>
    <div class="chart-caption">one column per trade · offers stacked by price →</div>
    <div class="chart-tip" hidden></div>`;
}

/* ---------------- supply & demand ----------------
 * Aggregate step curves for one round: supply is every producer cost sorted
 * ascending, demand every consumer value sorted descending. The crossing is the
 * competitive equilibrium the instructor sets price controls against.
 *
 * Same two categorical slots as the offer chart — each chart assigns from slot
 * 1 in fixed order, which is the rule, and supply keeps the blue that the sell
 * side already wears there. Palette validated on this surface earlier.
 */

const SD_GEO = {
  height: 250, padL: 46, padR: 22, padT: 22, padB: 34,
};

/** opts: { schedules, params, round, dealt } */
function renderSDChart(id, opts) {
  const el = document.getElementById(id);
  if (!el) return;
  const { costs = [], values = [] } = opts.schedules || {};

  if (!costs.length || !values.length) {
    el.innerHTML = `<div class="mount">${opts.dealt === false
      ? "Deal a round to see this round's supply and demand."
      : "Not enough producers and consumers to draw a market."}</div>`;
    return;
  }

  const ce = equilibriumOf({ costs, values });
  const floor = numOrNull(opts.params && opts.params.priceFloor);
  const ceiling = numOrNull(opts.params && opts.params.priceCeiling);

  // Marginal social cost = private cost − externality. A negative externality
  // (a cost) pushes it above supply; a positive one pulls it below.
  const ext = Number(opts.externality) || 0;
  const socialCosts = ext ? costs.map((c) => c - ext) : null;

  const all = costs.concat(values, socialCosts || [], [floor, ceiling].filter((v) => v !== null));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = Math.max(1, (hi - lo) * 0.1);
  lo -= pad; hi += pad;

  const n = Math.max(costs.length, values.length);
  const W = Math.max(el.clientWidth || 0, 320);
  const height = chartHeight(el, SD_GEO.height);
  const plotH = height - SD_GEO.padT - SD_GEO.padB;
  const plotW = W - SD_GEO.padL - SD_GEO.padR;
  const x = (q) => SD_GEO.padL + (q / n) * plotW;
  const y = (p) => SD_GEO.padT + (1 - (p - lo) / (hi - lo)) * plotH;
  const baseY = height - SD_GEO.padB;

  const grid = niceTicks(lo, hi, 4).map((t) => `
    <line x1="${SD_GEO.padL - 8}" x2="${W - 6}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"
          stroke="var(--border)" stroke-width="1"/>
    <text x="${SD_GEO.padL - 12}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="10"
          fill="var(--text-dim)" style="font-variant-numeric:tabular-nums">${money(t)}</text>`).join("");

  // Quantity ticks — a handful of round numbers, never one per unit.
  const qStep = Math.max(1, Math.ceil(n / 6));
  const qTicks = [];
  for (let q = 0; q <= n; q += qStep) qTicks.push(q);
  const qAxis = qTicks.map((q) => `
    <text x="${x(q).toFixed(1)}" y="${baseY + 15}" text-anchor="middle" font-size="10"
          fill="var(--text-dim)" style="font-variant-numeric:tabular-nums">${q}</text>`).join("");

  const stair = (arr) => {
    const pts = [];
    arr.forEach((p, i) => { pts.push(`${x(i).toFixed(1)},${y(p).toFixed(1)}`);
                            pts.push(`${x(i + 1).toFixed(1)},${y(p).toFixed(1)}`); });
    return pts.join(" ");
  };

  const curves = `
    <polyline points="${stair(costs)}" fill="none" stroke="${SERIES.offer}"
      stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${stair(values)}" fill="none" stroke="${SERIES.trade}"
      stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${socialCosts ? `<polyline points="${stair(socialCosts)}" fill="none"
      stroke="${SERIES.offer}" stroke-width="2" stroke-dasharray="5 4"
      stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>` : ""}`;

  // Where the market should stop once the spillover counts.
  const social = ext ? socialOptimumOf({ costs, values }, ext) : null;
  const socialMark = social && social.quantity ? `
    <line x1="${x(social.quantity).toFixed(1)}" x2="${x(social.quantity).toFixed(1)}"
          y1="${SD_GEO.padT}" y2="${baseY}" stroke="${SERIES.offer}"
          stroke-width="1" stroke-dasharray="5 4" opacity="0.75"/>
    <text x="${(x(social.quantity) + 6).toFixed(1)}" y="${SD_GEO.padT + 10}"
          font-size="10" font-weight="700" fill="var(--text-dim)">social q=${social.quantity}</text>` : "";

  // The crossing, marked with a dashed drop-line and one direct label.
  const ceMark = ce.quantity ? `
    <line x1="${x(ce.quantity).toFixed(1)}" x2="${x(ce.quantity).toFixed(1)}"
          y1="${SD_GEO.padT}" y2="${baseY}" stroke="var(--text-dim)"
          stroke-width="1" stroke-dasharray="4 4"/>
    <circle cx="${x(ce.quantity).toFixed(1)}" cy="${y((ce.priceLo + ce.priceHi) / 2).toFixed(1)}"
            r="6" fill="var(--bg)"/>
    <circle cx="${x(ce.quantity).toFixed(1)}" cy="${y((ce.priceLo + ce.priceHi) / 2).toFixed(1)}"
            r="4" fill="var(--text)"/>
    <text x="${(x(ce.quantity) + 9).toFixed(1)}"
          y="${(y((ce.priceLo + ce.priceHi) / 2) - 9).toFixed(1)}"
          font-size="11" font-weight="700" fill="var(--text)"
          style="font-variant-numeric:tabular-nums">CE q=${ce.quantity}</text>` : "";

  // The round's efficiency, so stepping the picker through rounds reads as a
  // round-by-round scoreboard rather than just a shape comparison.
  const effMark = opts.efficiency == null ? "" : `
    <text x="${W - 8}" y="${SD_GEO.padT - 8}" text-anchor="end" font-size="11" font-weight="700"
          fill="var(--text)" style="font-variant-numeric:tabular-nums">Efficiency ${efficiencyPct(opts.efficiency)}</text>`;

  const controls = [
    ceiling !== null ? { p: ceiling, label: `Ceiling ${money(ceiling)}` } : null,
    floor !== null ? { p: floor, label: `Floor ${money(floor)}` } : null,
  ].filter(Boolean).map((c) => `
    <line x1="${SD_GEO.padL - 8}" x2="${W - 6}" y1="${y(c.p).toFixed(1)}" y2="${y(c.p).toFixed(1)}"
          stroke="var(--text)" stroke-width="1" stroke-dasharray="6 3" opacity="0.55"/>
    <text x="${SD_GEO.padL - 4}" y="${(y(c.p) - 5).toFixed(1)}" font-size="10" font-weight="700"
          fill="var(--text-dim)">${c.label}</text>`).join("");

  // One hover band per unit, carrying both curves at that quantity.
  const bands = Array.from({ length: n }, (_, i) => {
    const tip = `Unit ${i + 1} · supply ${costs[i] == null ? "—" : money(costs[i])}`
      + ` · demand ${values[i] == null ? "—" : money(values[i])}`;
    return `<rect x="${x(i).toFixed(1)}" y="${SD_GEO.padT}" width="${(plotW / n).toFixed(1)}"
              height="${plotH}" fill="transparent" data-tip="${esc(tip)}" style="cursor:pointer"/>`;
  }).join("");

  const summary = `Supply and demand for ${goodName(opts.good || "tin")}, round ${opts.round}: `
    + `${costs.length} supply steps `
    + `from ${money(costs[0])} to ${money(costs[costs.length - 1])}, ${values.length} demand steps `
    + `from ${money(values[0])} down to ${money(values[values.length - 1])}. `
    + (ce.quantity ? `Equilibrium quantity ${ce.quantity} at ${money(ce.priceLo)}–${money(ce.priceHi)}.`
                   : "No profitable trades exist.")
    + (opts.efficiency == null ? "" : ` Efficiency ${efficiencyPct(opts.efficiency)}.`);

  el.innerHTML = `
    <div class="chart-legend">
      <span class="legend-item"><span class="dot" style="background:${SERIES.offer}"></span>Supply (costs)</span>
      <span class="legend-item"><span class="dot" style="background:${SERIES.trade}"></span>Demand (values)</span>
      ${ext ? `<span class="legend-item"><span class="legend-dash"
        style="border-top-color:${SERIES.offer}"></span>Social cost</span>` : ""}
    </div>
    <div class="chart-scroll">
      <svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"
           role="img" aria-label="${esc(summary)}">
        ${grid}
        <line x1="${SD_GEO.padL - 8}" x2="${W - 6}" y1="${baseY}" y2="${baseY}"
              stroke="var(--border)" stroke-width="1"/>
        ${qAxis}${controls}${curves}${ceMark}${socialMark}${effMark}${bands}
      </svg>
    </div>
    <div class="chart-caption">quantity →</div>
    <div class="chart-tip" hidden></div>`;
  attachTips(el);
}

function numOrNull(v) {
  return v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
}

/** Ticks on round money values (…, 0.5, 1, 2, 5, 10, 25 …) inside [lo, hi].
 * Takes the smallest step that keeps the tick count at or under the target,
 * so a narrow price range still gets gridlines rather than two lonely ones. */
function niceTicks(lo, hi, count) {
  const steps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  const ticksFor = (step) => {
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) {
      out.push(Math.round(t * 100) / 100);
    }
    return out;
  };
  for (const step of steps) {
    const out = ticksFor(step);
    if (out.length <= count + 1) return out.length ? out : [lo, hi];
  }
  return [lo, hi];
}

/* ---------------- table view (the same data, reachable without color) ---------------- */

function tableView(columns) {
  const multiRound = new Set(columns.map((c) => c.round)).size > 1;
  const seen = {};
  const rows = columns.map((col) => {
    seen[col.round] = (seen[col.round] || 0) + (col.trade ? 1 : 0);
    const label = col.trade ? `Trade ${seen[col.round]}` : "Open";
    return col.offers.map((o, k) => {
      const isTrade = col.trade && k === col.offers.length - 1;
      return `
        <tr>
          ${multiRound ? `<td class="num">${col.round}</td>` : ""}
          <td>${label}</td>
          <td>${isTrade ? "Traded" : "Offer"}</td>
          <td class="num">${money(o.price)}</td>
          <td>${esc(isTrade ? `${o.sellerName} → ${col.trade.buyerName}` : o.sellerName)}</td>
        </tr>`;
    }).join("");
  }).join("");
  return `
    <div class="table-scroll">
      <table class="table">
        <thead><tr>${multiRound ? "<th>Round</th>" : ""}
          <th>Column</th><th>Event</th><th>Price</th><th>Who</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ---------------- hover ---------------- */

function attachTips(el) {
  const tip = el.querySelector(".chart-tip");
  const scroll = el.querySelector(".chart-scroll");
  if (!tip || !scroll) return;
  scroll.addEventListener("mouseover", (e) => {
    const text = e.target.getAttribute && e.target.getAttribute("data-tip");
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const box = el.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(box.width - 200, e.clientX - box.left - 60))}px`;
    tip.style.top = `${e.clientY - box.top - 42}px`;
  });
  scroll.addEventListener("mouseout", (e) => {
    if (e.target.getAttribute && e.target.getAttribute("data-tip")) tip.hidden = true;
  });
}
