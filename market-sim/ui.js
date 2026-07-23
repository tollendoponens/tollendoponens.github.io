/* Rendering. Every function here is a pure read of state -> DOM.
 * No network calls, no rule logic — app.js owns those.
 */
"use strict";

const $ = (id) => document.getElementById(id);

const ROSTER_PAGE_SIZE = 8;
let rosterPage = 0;

function setRosterPage(delta) { rosterPage += delta; }

/** S&D card: which round's schedules to plot ("current" or a round number). */
let sdRound = "current";
let sdGood = "tin";
let sdPickerSig = "";

function setSDRound(value) {
  sdRound = value === "current" ? "current" : Number(value);
}

function setSDGood(value) { sdGood = value; }

/** Shape signatures — the student panes rebuild only when these change, so a
 *  1Hz repaint can't steal focus from an input mid-keystroke. */
let marketShape = "";
let scheduleShape = "";

const UI = {
  /* ---------------- shell ---------------- */

  showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    $(`view-${name}`).classList.add("is-active");
  },

  toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    $("toast-wrap").appendChild(el);
    setTimeout(() => el.remove(), 5000);
  },

  /** Generic confirm/prompt modal. bodyHtml may contain inputs; onConfirm reads them. */
  modal({ kicker, title, bodyHtml, confirmText = "Confirm", hideCancel = false, onConfirm }) {
    $("modal-kicker").textContent = kicker || "";
    $("modal-title").textContent = title || "";
    $("modal-body").innerHTML = bodyHtml || "";
    $("modal-confirm").textContent = confirmText;
    $("modal-cancel").hidden = hideCancel;
    $("modal-overlay").classList.add("is-open");
    $("modal-confirm").onclick = () => {
      if (!onConfirm || onConfirm() !== false) UI.closeModal();
    };
  },

  closeModal() { $("modal-overlay").classList.remove("is-open"); },

  /* ---------------- instructor dashboard ---------------- */

  renderTeacher(state) {
    const ce = equilibrium(state);
    const eff = efficiency(state);
    const avg = avgTradePrice(state);
    const list = studentList(state);
    const producers = list.filter((s) => s.role === ROLE.PRODUCER && s.connected).length;
    const consumers = list.filter((s) => s.role === ROLE.CONSUMER && s.connected).length;

    $("t-code").textContent = `CODE ${state.code}`;
    $("t-round").textContent = state.round
      ? `Round ${state.round} of ${state.params.totalRounds}`
      : `${state.params.totalRounds} rounds`;
    $("t-clock").textContent = formatClock(secondsLeft(state));
    $("t-phase").textContent = phaseLabel(state.phase);
    $("t-phase").className = `tag ${phaseTagClass(state.phase)}`;

    $("t-kpi-connected").textContent = connectedCount(state);
    $("t-kpi-connected-sub").textContent = `${producers} producers · ${consumers} consumers`;
    $("t-kpi-trades").textContent = state.market.trades.length;
    $("t-kpi-trades-sub").textContent = `CE quantity ${ce.quantity || "—"}`;
    $("t-kpi-price").textContent = avg == null ? "—" : money(avg);
    $("t-kpi-price-sub").textContent = ce.priceLo == null
      ? "CE band —"
      : `CE band ${money(ce.priceLo)}–${money(ce.priceHi)}`;
    // One measure, one label. Efficiency already counts the spillover, so
    // there's nothing to switch the tile to — only the sub-line grows a note
    // saying how much of the total the spillover accounts for.
    const score = surplusScore(state);
    $("t-kpi-eff").textContent = efficiencyPct(eff);
    $("t-kpi-eff-sub").textContent = !score
      ? "of maximum surplus"
      : `${money(score.surplus)} of ${money(score.max)}`
        + (anyExternality(state) ? ` · ${signedMoney(externalTotal(state))} spillover` : "");
    $("t-roster-count").textContent = `${connectedCount(state)} connected`;

    $("t-btn-advance").textContent = advanceLabel(state);
    $("t-btn-advance").disabled = state.phase === PHASE.DONE;
    $("t-btn-pause").textContent = state.phase === PHASE.PAUSED ? "Unfreeze market" : "Freeze market";
    $("t-btn-pause").disabled = state.phase !== PHASE.OPEN && state.phase !== PHASE.PAUSED;

    UI.renderRoster(state);
    UI.renderTrades(state);
    UI.renderFeed(state.log, $("t-feed"), $("t-feed-empty"));
    renderOfferChart("t-chart", {
      market: state.market, round: state.round, archive: state.rounds,
      params: state.params, goods: activeGoods(state),
    });
    UI.renderSD(state);
    UI.renderDemo(state);
    $("t-ext-copper-field").hidden = !state.params.twoGoods;
  },

  /** Supply and demand for whichever round and good the S&D pickers are on. */
  renderSD(state) {
    const sel = $("t-sd-select");
    const goodSel = $("t-sd-good");
    const dealt = hasSchedules(state);
    const goods = activeGoods(state);
    if (!goods.includes(sdGood)) sdGood = goods[0];

    const rounds = availableRounds(state.rounds, state.round);
    const sig = `${rounds.join(",")}|${state.round}`;
    if (sdPickerSig !== sig && sel) {
      sdPickerSig = sig;
      sel.innerHTML = rounds.map((r) => r === state.round
        ? `<option value="current">Round ${r} · live</option>`
        : `<option value="${r}">Round ${r}</option>`).join("")
        || `<option value="current">Round —</option>`;
    }
    if (sel && sel.value !== String(sdRound)) sel.value = String(sdRound);

    if (goodSel) {
      goodSel.hidden = goods.length < 2;
      if (goods.length > 1 && goodSel.dataset.sig !== goods.join(",")) {
        goodSel.dataset.sig = goods.join(",");
        goodSel.innerHTML = goods.map((g) => `<option value="${g}">${goodName(g)}</option>`).join("");
      }
      if (goodSel.value !== sdGood) goodSel.value = sdGood;
    }

    // Past rounds plot their archived schedules; the live round plots the
    // dealt-but-not-yet-traded ones, which is the point of the pre-market look.
    const archived = state.rounds.find((r) => r.round === sdRound);
    const schedules = archived
      ? (archived.schedules[sdGood] || { costs: [], values: [] })
      : scheduleSnapshot(state, sdGood);
    const shownRound = archived ? archived.round : state.round;
    const params = archived ? {} : state.params;
    // An archived round is scored and drawn under the spillover it was played
    // under, never today's — the rule the price controls already follow.
    const agg = archived ? archivedAggExt(archived, sdGood)
                         : aggregateExternality(state, sdGood);
    const score = archived
      ? roundScore(archived, sdGood)
      : scoreGood(schedules, tradesOf(state, sdGood), agg);

    renderSDChart("t-sd", {
      schedules, params, round: shownRound, good: sdGood, dealt,
      externality: agg, efficiency: ratioOf(score),
    });

    const ce = schedules && schedules.costs.length ? equilibriumOf(schedules) : { quantity: 0 };
    $("t-sd-note").textContent = !dealt
      ? "Curves appear once a round is dealt."
      : (archived
        ? `Round ${shownRound} as dealt — equilibrium quantity ${ce.quantity}.`
        : "This round's schedules. Price controls are drawn where you set them.")
        + (score ? ` Efficiency ${efficiencyPct(ratioOf(score))} — ${money(score.surplus)} of ${money(score.max)}.` : "")
        + (goods.length > 1
          ? " With two goods, capacity is shared, so this is one good's curves in isolation."
          : "");
  },

  /** Shock record. */
  renderDemo(state) {
    const shocks = state.shocks || [];
    $("t-shock-tag").textContent = shocks.length
      ? `${shocks.length} shock${shocks.length === 1 ? "" : "s"} applied`
      : "no shocks yet";
    $("t-shock-tag").className = `tag ${shocks.length ? "tag-warn" : "tag-outline"}`;
  },

  renderRoster(state) {
    const all = studentList(state);
    $("t-roster-empty").hidden = all.length > 0;

    // Page through, so a 20-plus class doesn't run the card off the screen.
    const pages = Math.max(1, Math.ceil(all.length / ROSTER_PAGE_SIZE));
    if (rosterPage >= pages) rosterPage = pages - 1;
    if (rosterPage < 0) rosterPage = 0;
    const from = rosterPage * ROSTER_PAGE_SIZE;
    const rows = all.slice(from, from + ROSTER_PAGE_SIZE);

    $("t-roster-pager").hidden = all.length <= ROSTER_PAGE_SIZE;
    $("t-roster-info").textContent = all.length
      ? `${from + 1}–${from + rows.length} of ${all.length}`
      : "—";
    $("t-roster-prev").disabled = rosterPage === 0;
    $("t-roster-next").disabled = rosterPage >= pages - 1;

    $("t-roster-body").innerHTML = rows.map((s) => `
      <tr>
        <td><span class="roster-name"><span class="dot ${s.connected ? "dot-live" : "dot-gone"}"></span>${esc(s.name)}</span></td>
        <td>${roleTag(s.role)}</td>
        <td class="num">${unitsTraded(s)} / ${state.params.unitsPerPlayer}</td>
        <td class="num">${signed(roundNet(s))}${s.borne
          ? ` <span style="color:var(--text-dim);font-weight:400">(${signedPlain(s.borne)} borne)</span>` : ""}</td>
        <td class="num">${money(s.totalProfit)}</td>
        <td style="text-align:right;"><button class="btn btn-ghost" data-inspect="${esc(s.id)}">Inspect</button></td>
      </tr>`).join("");
  },

  renderTrades(state) {
    const t = state.market.trades;
    $("t-trades-empty").hidden = t.length > 0;
    $("t-trades-body").innerHTML = t.slice().reverse().map((x, i) => `
      <tr>
        <td class="num">${t.length - i}${x.good && state.params.twoGoods ? ` <span class="tag tag-neutral">${goodName(x.good)}</span>` : ""}</td>
        <td class="num">${money(x.price)}</td>
        <td>${esc(x.sellerName)} <span style="color:var(--text-dim)">(cost ${money(x.cost)})</span></td>
        <td>${esc(x.buyerName)} <span style="color:var(--text-dim)">(value ${money(x.value)})</span></td>
        <td class="num">${money(x.value - x.cost)}</td>
      </tr>`).join("");
  },

  renderFeed(entries, feedEl, emptyEl) {
    const items = entries.slice(0, 60);
    emptyEl.hidden = items.length > 0;
    feedEl.innerHTML = items.map((e) => `
      <div class="feed-item">
        <span class="feed-time">${clockTime(e.ts)}</span>
        <span>${esc(e.text)}</span>
      </div>`).join("");
  },

  /* ---------------- student dashboard ---------------- */

  renderStudent(view) {
    const me = view.me || {};
    const isProducer = me.role === ROLE.PRODUCER;
    const open = view.phase === PHASE.OPEN;
    const goods = view.goods || ["tin"];

    $("s-name").textContent = me.name || "—";
    $("s-role").textContent = me.role ? (isProducer ? "Producer" : "Consumer") : "—";
    $("s-role").className = `tag ${isProducer ? "tag-accent" : "tag-outline"}`;
    $("s-round").textContent = view.round ? `Round ${view.round} of ${view.params.totalRounds}` : "Lobby";
    $("s-clock").textContent = formatClock(secondsLeft(view));

    const dealt = me.units && Object.keys(me.units).length > 0;
    const traded = dealt ? unitsTraded(me) : 0;
    const left = view.params.unitsPerPlayer - traded;

    const borne = me.borne || 0;
    const net = dealt ? roundProfit(me) + borne : 0;
    $("s-kpi-profit").textContent = dealt ? signedPlain(net) : "—";
    // The round's breakdown lives here; the running game total is in the nav,
    // where it stays visible. It used to share this slot and so vanished for
    // the whole of any round that carried a spillover.
    $("s-kpi-profit-sub").textContent = borne
      ? `${signedPlain(roundProfit(me))} trading, ${signedPlain(borne)} from others' trades`
      : "this round";
    $("s-kpi-profit-sub").className = `tag ${borne < 0 ? "tag-danger" : borne > 0 ? "tag-accent" : "tag-neutral"}`;

    // Banked at the end of each round, so it moves at close, not per trade.
    const total = me.totalProfit || 0;
    $("s-total").textContent = `Game total ${signedPlain(total)}`;
    $("s-total").className = `tag ${total < 0 ? "tag-danger" : total > 0 ? "tag-accent" : "tag-neutral"}`;
    $("s-kpi-units-label").textContent = isProducer ? "Units sold" : "Units bought";
    $("s-kpi-units").textContent = dealt ? traded : "—";
    $("s-kpi-units-sub").textContent = `of ${view.params.unitsPerPlayer}`;
    $("s-kpi-status").textContent = phaseLabel(view.phase);
    $("s-kpi-status-sub").textContent = open
      ? `${formatClock(secondsLeft(view))} left`
      : "waiting for the instructor";

    $("s-market-title").textContent = goods.length > 1 ? "Current sell offers" : "Current sell offer";
    $("s-capacity").textContent = dealt
      ? `${left} of ${view.params.unitsPerPlayer} units left`
      : "—";

    /* price controls, if any */
    const { priceFloor, priceCeiling } = view.params;
    const hasControls = priceFloor != null || priceCeiling != null;
    $("s-controls").hidden = !hasControls;
    if (hasControls) {
      $("s-controls").innerHTML = [
        priceFloor != null ? `<span class="tag tag-warn">Floor ${money(priceFloor)}</span>` : "",
        priceCeiling != null ? `<span class="tag tag-warn">Ceiling ${money(priceCeiling)}</span>` : "",
        `<span class="card-note" style="margin:0;">offers must stay within the limits</span>`,
      ].join(" ");
    }

    $("s-market-closed").hidden = open;
    $("s-market-closed").textContent = closedMessage(view.phase);

    // The market blocks contain text inputs. Rebuilding them on the 1Hz tick
    // blew away focus and whatever the student was halfway through typing, so
    // the DOM is only rebuilt when its *shape* changes; everything volatile is
    // written in place below.
    const shape = [goods.join(","), me.role, open, goods.length > 1,
      JSON.stringify(view.params.externality || {})].join("|");
    if (marketShape !== shape) {
      marketShape = shape;
      $("s-markets").innerHTML = open
        ? goods.map((g) => marketShell(view, g, isProducer, goods.length > 1)).join("")
        : "";
    }
    if (open) goods.forEach((g) => updateMarketBlock(view, me, g, isProducer, left));

    UI.renderSchedules(view, me, isProducer, goods);
    UI.renderFeed(view.messages || [], $("s-feed"), $("s-feed-empty"));
    renderOfferChart("s-chart", {
      market: view.market, round: view.round, archive: view.market.rounds,
      params: view.params, goods,
    });
  },

  /** One schedule table per good. With two goods, capacity is shared, so the
   *  student has to decide which good to spend it on — that's the substitution
   *  margin the price signal is supposed to steer. */
  renderSchedules(view, me, isProducer, goods) {
    const dealt = me.units && Object.keys(me.units).length > 0;
    $("s-units-empty").hidden = !!dealt;
    $("s-units-empty").textContent =
      "Your schedule is dealt just before the market opens — it'll appear here.";
    $("s-sched-title").textContent = isProducer ? "Your cost schedule" : "Your demand schedule";
    // Only worth a tag with two goods, where the shared-capacity tradeoff
    // isn't obvious from the title alone. One good needs no caption — the
    // title and the rows themselves already say what's rising or falling.
    $("s-sched-tag").hidden = goods.length <= 1;
    if (goods.length > 1) {
      $("s-sched-tag").textContent = `${view.params.unitsPerPlayer} units total, your choice of good`;
    }

    if (!dealt) { $("s-schedules").innerHTML = ""; $("s-summary").innerHTML = ""; return; }

    // Same guard as the market blocks: rebuild only when the content changes.
    const shape = JSON.stringify(me.units) + "|" + goods.join(",") + "|" + me.role;
    if (scheduleShape === shape) { UI.renderSummary(view, me, isProducer); return; }
    scheduleShape = shape;

    $("s-schedules").innerHTML = goods.map((g) => {
      const units = me.units[g] || [];
      const nextU = units.find((u) => u.price === null);
      const rows = units.map((u) => {
        const p = unitProfit(me, u);
        return `
          <tr${u === nextU ? ' style="background:var(--accent-light)"' : ""}>
            <td class="num">${u.n}</td>
            <td class="num">${money(u.value)}</td>
            <td class="num">${u.price === null ? "—" : money(u.price)}</td>
            <td class="num">${p === null ? "—" : signed(p)}</td>
          </tr>`;
      }).join("");
      const total = units.reduce((sum, u) => sum + (unitProfit(me, u) || 0), 0);
      return `
        ${goods.length > 1 ? `<div class="card-kicker" style="margin-top:14px;">${goodName(g)}</div>` : ""}
        <table class="table" style="margin-top:8px;">
          <thead><tr>
            <th>Unit</th>
            <th>${isProducer ? "Cost" : "Value"}</th>
            <th>${isProducer ? "Price sold" : "Price paid"}</th>
            <th>${isProducer ? "Profit" : "Surplus"}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3">${goodName(g)} total</td>
            <td class="num">${signed(total)}</td></tr></tfoot>
        </table>`;
    }).join("");
    UI.renderSummary(view, me, isProducer);
  },

  /** The two numbers that carry the externality lesson, side by side:
   *  what your trades did to everyone else, and what theirs did to you. */
  renderSummary(view, me, isProducer) {
    const caused = me.caused || 0;
    const borne = me.borne || 0;
    if (!caused && !borne) { $("s-summary").innerHTML = ""; return; }
    const trading = roundProfit(me);
    $("s-summary").innerHTML = `
      <div class="summary-row">
        <span>${isProducer ? "Trading profit" : "Trading surplus"}</span>
        <span class="num">${signed(trading)}</span>
      </div>
      <div class="summary-row muted">
        <span>You put on everyone else <em>— you don't pay this</em></span>
        <span class="num">${signedPlain(caused)}</span>
      </div>
      <div class="summary-row">
        <span>Charged to you by other people's trades</span>
        <span class="num">${signed(borne)}</span>
      </div>
      <div class="summary-row total">
        <span>Round net</span>
        <span class="num">${signed(trading + borne)}</span>
      </div>`;
  },


  setConnection(status) {
    const el = $("s-conn");
    const map = {
      connecting: ["dot-idle", "connecting", "tag-neutral"],
      live: ["dot-live", "connected", "tag-accent"],
      lost: ["dot-gone", "disconnected", "tag-danger"],
    };
    const [dot, label, tag] = map[status] || map.connecting;
    el.className = `tag ${tag}`;
    el.innerHTML = `<span class="dot ${dot}"></span> ${label}`;
    $("s-banner").classList.toggle("is-open", status === "lost");
  },
};

/** Static skeleton for one good — built once per shape change, never on a tick,
 *  so the price input keeps its focus and its half-typed value. */
function marketShell(view, good, isProducer, showName) {
  const e = Number((view.params.externality || {})[good]) || 0;
  const others = Math.max(0, (view.peerCount || 0) - 2);
  const spill = e === 0 ? "" : `
    <div class="spillover">
      <span class="tag ${e < 0 ? "tag-danger" : "tag-accent"}">${signedPlain(e)} each</span>
      <span>Every ${goodName(good).toLowerCase()} unit traded ${e < 0 ? "takes" : "gives"}
        <strong>${money(Math.abs(e))}</strong> ${e < 0 ? "from" : "to"}
        <strong>every other student</strong>${others ? ` (${others} people)` : ""}.
        The two people in the trade pay nothing — including you, when it's yours.</span>
    </div>`;

  const action = isProducer
    ? `<div style="display:flex;gap:10px;align-items:flex-end;margin-top:10px;">
         <div class="field" style="flex:1;">
           <label for="s-offer-${good}">Asking price (whole dollars)</label>
           <input class="input" id="s-offer-${good}" type="number" step="1" min="1" placeholder="0">
         </div>
         <button class="btn btn-primary" id="s-act-${good}" data-offer-good="${good}">Post</button>
       </div>`
    : `<button class="btn btn-primary btn-block" style="margin-top:10px;"
               id="s-act-${good}" data-buy-good="${good}">Buy</button>`;

  return `<div class="market-block">
    <div class="ask-box">
      <div>
        ${showName ? `<div class="card-kicker">${goodName(good)}</div>` : ""}
        <div class="ask-price" id="s-ask-${good}">—</div>
        <div class="ask-meta" id="s-askmeta-${good}">no offer on the book</div>
      </div>
    </div>${spill}
    ${action}
    <p class="card-note" id="s-hint-${good}"></p>
  </div>`;
}

/** Everything volatile, written in place. Touches no input's value. */
function updateMarketBlock(view, me, good, isProducer, capacityLeftNow) {
  const book = view.market.books[good] || {};
  const ask = book.ask;
  const units = (me.units && me.units[good]) || [];
  const next = units.find((u) => u.price === null);
  const { priceFloor, priceCeiling } = view.params;
  const spent = capacityLeftNow <= 0;

  const price = $(`s-ask-${good}`);
  if (!price) return;
  setText(price, ask ? money(ask.price) : "—");
  setText($(`s-askmeta-${good}`), ask ? `posted by ${ask.sellerName}` : "no offer on the book");

  const btn = $(`s-act-${good}`);
  const input = $(`s-offer-${good}`);
  const hint = $(`s-hint-${good}`);

  if (isProducer) {
    const mustBeat = ask ? ask.price - 1 : (priceCeiling != null ? priceCeiling : null);
    const blocked = spent || !next;
    setDisabled(btn, blocked);
    setDisabled(input, blocked);
    setHTML(hint, blocked
      ? (spent ? "You've used your whole capacity this round."
               : `No ${goodName(good).toLowerCase()} units left.`)
      : `Your next ${goodName(good).toLowerCase()} unit costs <strong>${money(next.value)}</strong>. `
        + (ask === null
          ? (mustBeat === null
            ? "The book is empty — any whole-dollar price opens it."
            : `The book is empty — anything up to <strong>${money(mustBeat)}</strong> opens it.`)
          : `To take the book you must offer <strong>${money(mustBeat)}</strong> or less`)
        + (priceFloor != null ? `, and no lower than <strong>${money(priceFloor)}</strong>.` : "."));
    return;
  }

  const blocked = spent || !next || !ask;
  setDisabled(btn, blocked);
  setText(btn, ask ? `Buy ${goodName(good)} at ${money(ask.price)}` : "No offer to buy");
  setHTML(hint, spent
    ? "You've spent your whole capacity this round."
    : !next ? `No ${goodName(good).toLowerCase()} units left to buy.`
    : !ask ? "Wait for a producer to post an offer."
    : `Your next ${goodName(good).toLowerCase()} unit is worth <strong>${money(next.value)}</strong> to you — `
      + `buying at ${money(ask.price)} ${next.value - ask.price >= 0 ? "gains" : "loses"} `
      + `<strong>${money(Math.abs(next.value - ask.price))}</strong>.`);
}

/* Write only on change — a needless assignment can still disturb the caret. */
function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }
function setHTML(el, s) { if (el && el.innerHTML !== s) el.innerHTML = s; }
function setDisabled(el, v) { if (el && el.disabled !== v) el.disabled = v; }

/* ---------------- small helpers ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Profit in ink that carries the sign — never a bare colored number. */
function signed(n) {
  if (n == null) return "—";
  if (n === 0) return `<span>${money(0)}</span>`;
  return `<span class="${n > 0 ? "pos" : "neg"}">${n > 0 ? "+" : ""}${money(n)}</span>`;
}

function signedPlain(n) {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${money(n)}`;
}

function roleTag(role) {
  return role === ROLE.PRODUCER
    ? '<span class="tag tag-accent">Producer</span>'
    : '<span class="tag tag-neutral">Consumer</span>';
}

function phaseLabel(phase) {
  return {
    lobby: "Lobby", ready: "Pre-market", open: "Open", paused: "Frozen",
    between: "Closed", done: "Finished",
  }[phase] || phase;
}

function phaseTagClass(phase) {
  if (phase === PHASE.OPEN) return "tag-accent";
  if (phase === PHASE.PAUSED) return "tag-warn";
  return "tag-neutral";
}

function advanceLabel(state) {
  if (state.phase === PHASE.LOBBY) return "Deal round 1";
  if (state.phase === PHASE.BETWEEN) return "Deal next round";
  if (state.phase === PHASE.READY) return "Open market";
  if (state.phase === PHASE.DONE) return "Session over";
  return "Close market";
}

function closedMessage(phase) {
  return {
    lobby: "Waiting for the instructor to deal the first round.",
    ready: "Your schedule is below — study it. The market opens shortly.",
    paused: "The instructor froze the market. Hold on.",
    between: "The market is closed. Wait for the next round to be dealt.",
    done: "The session is over. Thanks for playing.",
  }[phase] || "The market is closed.";
}
