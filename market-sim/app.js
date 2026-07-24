/* Bootstrap, wiring, and the market rules.
 *
 * The instructor's tab is the only place rules run. Students send intents
 * (OFFER, BUY); the host validates them against its own state and fans out a
 * fresh snapshot. Nothing a student sends is trusted.
 */
"use strict";

let session = null;   // host: authoritative state
let view = null;      // student: latest snapshot from the host
let screenState = null;  // projector: latest public snapshot from the host
let tick = null;
let previewing = false;

/* Peer ids of attached projectors. Deliberately NOT in session state: a
 * display takes no seat, so it must not affect role balancing, the roster,
 * the headcount, or the bystander count an externality is divided among. */
const screens = new Set();

/* ================= boot ================= */

window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(location.search);
  const preview = params.get("preview");

  document.addEventListener("click", (e) => {
    const id = e.target.dataset && e.target.dataset.chartToggle;
    if (!id) return;
    toggleChartMode(id);
    repaintChart(id);
  });

  document.addEventListener("change", (e) => {
    const d = e.target.dataset || {};
    if (d.chartRound) {
      setChartRound(d.chartRound, e.target.value);
      repaintChart(d.chartRound);
    } else if (d.chartGood) {
      setChartGood(d.chartGood, e.target.value);
      repaintChart(d.chartGood);
    } else if (d.sdRound && session) {
      setSDRound(e.target.value);
      UI.renderSD(session);
    } else if (d.sdGood && session) {
      setSDGood(e.target.value);
      UI.renderSD(session);
    }
  });

  // Fullscreen a chart card for the debrief; charts redraw into the space.
  document.addEventListener("click", (e) => {
    const id = e.target.dataset && e.target.dataset.chartFull;
    if (!id) return;
    const card = document.getElementById(id).closest(".card");
    if (document.fullscreenElement) document.exitFullscreen();
    else if (card.requestFullscreen) card.requestFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    // Give the browser a frame to settle the new box before measuring it.
    setTimeout(() => {
      repaintChart("t-chart");
      repaintChart("p-chart");
      if (session) UI.renderSD(session);
    }, 60);
  });
  window.addEventListener("resize", () => {
    if (!document.fullscreenElement) return;
    repaintChart("t-chart");
    repaintChart("p-chart");
    if (session) UI.renderSD(session);
  });

  if (preview) return startPreview(preview);

  $("btn-create").onclick = createSession;
  $("btn-join").onclick = joinSession;
  $("btn-watch").onclick = watchSession;
  $("btn-resume").onclick = resumeSession;
  $("btn-discard").onclick = discardSaved;
  $("join-code").oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
  $("watch-code").oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
  $("modal-cancel").onclick = UI.closeModal;
  $("modal-overlay").onclick = (e) => { if (e.target.id === "modal-overlay") UI.closeModal(); };

  offerResume();
  UI.showView("landing");
});

/** Repaint one chart from whichever state this tab owns. */
function repaintChart(id) {
  if (id === "t-chart" && session) {
    renderOfferChart(id, {
      market: session.market, round: session.round, archive: session.rounds,
      params: session.params, goods: activeGoods(session),
    });
  } else if (id === "p-chart" && screenState) {
    renderOfferChart(id, {
      market: screenState.market, round: screenState.round,
      archive: screenState.market.rounds,
      params: screenState.params, goods: screenState.goods,
    });
  }
}

/** Surface an autosaved session, if this browser hosted one. */
function offerResume() {
  const saved = loadSession();
  if (!saved || !saved.code) return;
  const students = Object.keys(saved.students || {}).length;
  $("resume-detail").textContent =
    `Code ${saved.code} · round ${saved.round || 0} of ${saved.params.totalRounds} · `
    + `${students} student${students === 1 ? "" : "s"}. `
    + "Profits, schedules and the offer chart come back with it.";
  $("resume-card").hidden = false;
}

function discardSaved() {
  clearSession();
  $("resume-card").hidden = true;
}

/* ================= instructor ================= */

async function createSession() {
  $("btn-create").disabled = true;
  $("btn-create").textContent = "Creating…";
  try {
    const code = await Net.host();
    session = newSessionState(code);
    pushLog(session, `Session created — code ${code}`);
    goLive();
  } catch (err) {
    $("btn-create").disabled = false;
    $("btn-create").textContent = "Create session";
    UI.toast("Could not start a session. Check your connection and try again.");
  }
}

/** Pick the autosaved session back up on its original code. */
async function resumeSession() {
  const saved = loadSession();
  if (!saved) return;
  $("btn-resume").disabled = true;
  $("btn-resume").textContent = "Resuming…";
  try {
    await Net.host(saved.code);
    session = saved;
    session.rounds = session.rounds || [];   // saves predating the round archive
    // Every student's connection died with the old tab; they must rejoin.
    studentList(session).forEach((s) => { s.connected = false; });
    // Don't let a stale deadline fire the moment we're back — hand the call to
    // the instructor by resuming frozen, with whatever time was left.
    if (session.phase === PHASE.OPEN || session.phase === PHASE.PAUSED) {
      session.frozenWith = session.endsAt
        ? Math.max(5, Math.round((session.endsAt - Date.now()) / 1000))
        : session.frozenWith;
      session.endsAt = null;
      session.phase = PHASE.PAUSED;
    }
    pushLog(session, "Session resumed — market frozen, students must rejoin");
    goLive();
  } catch (err) {
    $("btn-resume").disabled = false;
    $("btn-resume").textContent = "Resume";
    UI.toast(err && err.type === "unavailable-id"
      ? "That code is still registered — wait about a minute and try again."
      : "Could not resume. Check your connection and try again.");
  }
}

function goLive() {
  wireHost();
  syncParamInputs();
  UI.showView("teacher");
  startTicking(hostTick);
}

/** The host's per-second beat. Presence is swept here rather than left to
 *  conn.on("close"), which a closed tab frequently never fires. */
function hostTick() {
  if (!previewing && sweepStale(session)) syncAll();
  UI.renderTeacher(session);
}

/** Push saved params back into the form — matters on resume, where the HTML
 *  defaults would otherwise misreport the session's actual settings. */
function syncParamInputs() {
  const p = session.params;
  const preset = $("t-curve-preset");
  if (preset && preset.options.length <= 1) {
    preset.innerHTML = '<option value="">Choose…</option>'
      + Object.keys(CURVE_PRESETS).map((k) =>
        `<option value="${k}">${CURVE_PRESETS[k].label}</option>`).join("");
  }
  $("t-param-rounds").value = p.totalRounds;
  $("t-param-length").value = p.roundLengthSec;
  $("t-param-units").value = p.unitsPerPlayer;
  $("t-param-floor").value = p.priceFloor == null ? "" : p.priceFloor;
  $("t-param-ceiling").value = p.priceCeiling == null ? "" : p.priceCeiling;
  $("t-param-twogoods").checked = !!p.twoGoods;
  $("t-param-keep").checked = !!p.keepSchedules;
  $("t-ext-tin").value = (p.externality && p.externality.tin) || 0;
  $("t-ext-copper").value = (p.externality && p.externality.copper) || 0;
  $("t-curve-slow").value = p.supplyLow;
  $("t-curve-shigh").value = p.supplyHigh;
  $("t-curve-dhigh").value = p.demandHigh;
  $("t-curve-dlow").value = p.demandLow;
  $("t-curve-noise").value = p.noise;
  const mode = document.querySelector(`input[name="t-mode"][value="${p.mode}"]`);
  if (mode) mode.checked = true;
}

function wireHost() {
  Net.on(MSG.HELLO, (payload, peerId) => {
    const name = String(payload.name || "Student").slice(0, 32);

    // The name is the rejoin token. A student who refreshes, changes device or
    // waits out a host restart types the same name and lands back in their seat
    // with their role, schedule, units already traded and running total intact.
    const existing = findByName(session, name);
    if (existing) {
      reseat(session, existing, peerId);
      existing.connected = true;
      existing.lastSeen = Date.now();
      pushLog(session, `${name} rejoined as ${existing.role}`);
      syncAll();
      return;
    }

    const role = nextRole(session);
    session.students[peerId] = newStudent(peerId, name, role);
    // A late joiner needs a schedule if the round is already dealt. Re-dealing
    // everyone keeps the aggregate curves the shape the instructor asked for.
    if (session.phase !== PHASE.LOBBY && hasSchedules(session)) rollAllSchedules(session);
    pushLog(session, `${name} joined as ${role}`);
    syncAll();
  });

  Net.on(MSG.PING, (_payload, peerId) => {
    const s = session.students[peerId];
    if (!s) return;
    s.lastSeen = Date.now();
    if (!s.connected) {          // came back without a reload
      s.connected = true;
      pushLog(session, `${s.name} is back in contact`);
      syncAll();
    }
  });

  // A projector attaching. It gets no student record at all, so it can't be
  // dealt a schedule, can't be assigned a role, and never shows in the roster.
  Net.on(MSG.WATCH, (_payload, peerId) => {
    screens.add(peerId);
    Net.sendTo(peerId, MSG.SCREEN, screenView(session));
  });

  Net.on(MSG.OFFER, (payload, peerId) => handleOffer(peerId, payload));
  Net.on(MSG.BID, (payload, peerId) => handleBid(peerId, payload));
  Net.on(MSG.BUY, (payload, peerId) => handleBuy(peerId, payload));
  Net.on(MSG.SELL, (payload, peerId) => handleSell(peerId, payload));

  Net.onDisconnect((peerId) => {
    if (screens.delete(peerId)) return;   // a display closing changes nothing
    const s = session.students[peerId];
    if (!s) return;
    s.connected = false;
    pushLog(session, `${s.name} disconnected`);
    syncAll();
  });

  bindTeacherControls();
}

/** Split out from wireHost so preview mode gets working controls too. */
function bindTeacherControls() {
  $("t-btn-advance").onclick = advancePhase;
  $("t-btn-pause").onclick = toggleFreeze;
  $("t-btn-broadcast").onclick = openBroadcastModal;
  $("t-btn-apply").onclick = applyParams;
  $("t-btn-controls").onclick = applyControls;
  $("t-btn-reroll").onclick = rerollSchedules;
  $("t-btn-reset").onclick = resetSession;
  $("modal-cancel").onclick = UI.closeModal;
  $("modal-overlay").onclick = (e) => { if (e.target.id === "modal-overlay") UI.closeModal(); };
  $("t-roster-body").onclick = (e) => {
    const id = e.target.dataset && e.target.dataset.inspect;
    if (id) openInspector(id);
  };
  $("t-roster-prev").onclick = () => { setRosterPage(-1); UI.renderRoster(session); };
  $("t-roster-next").onclick = () => { setRosterPage(1); UI.renderRoster(session); };
  $("t-btn-shock").onclick = openShockModal;
  $("t-curve-preset").onchange = (e) => { applyPreset(e.target.value); e.target.value = ""; };
}

/* ---------------- market rules (host only) ---------------- */

/** Reject an intent and tell only the student who sent it. */
function reject(peerId, text) {
  Net.sendTo(peerId, MSG.TOAST, { text });
}

/* ---------------- the double auction ----------------
 * Both sides post. A sell offer that meets the standing bid — or a buy offer
 * that meets the standing ask — trades on the spot, at the RESTING order's
 * price: whoever committed to a number first sets the terms, which is what
 * makes posting worth doing rather than always waiting to accept.
 *
 * Only the best order rests on each side, and a new one must strictly improve
 * on it. Since any crossing pair trades immediately, a resting bid is always
 * strictly below a resting ask, so at most one of the two checks can fire.
 */

/** Shared validation for anyone putting a price into a book. Returns null and
 *  tells the student why, or the resolved order if it is allowed to proceed. */
function validateOrder(peerId, student, payload, wantRole, verb) {
  const deny = (text) => { reject(peerId, text); return null; };

  if (!isRoundOpen(session)) return deny("The market is closed.");
  if (student.role !== wantRole) {
    return deny(wantRole === ROLE.PRODUCER
      ? "Only producers post sell offers." : "Only consumers post buy offers.");
  }
  const good = activeGoods(session).includes(payload && payload.good)
    ? payload.good : activeGoods(session)[0];
  const book = session.market.books[good];
  if (!book) return null;

  const unit = nextUnit(student, good);
  if (!unit) return deny(`No ${goodName(good).toLowerCase()} units left to ${verb}.`);
  if (capacityLeft(student, session.params) <= 0) {
    return deny("You've used your whole capacity this round.");
  }

  // Whole dollars only — the schedules are integers and so is the book.
  const price = Number(payload.price);
  if (!Number.isInteger(price) || price <= 0) {
    return deny("Prices must be a whole number of dollars.");
  }
  const { priceFloor, priceCeiling } = session.params;
  if (priceFloor != null && price < priceFloor) return deny(`Price floor: nothing below ${money(priceFloor)}.`);
  if (priceCeiling != null && price > priceCeiling) return deny(`Price ceiling: nothing above ${money(priceCeiling)}.`);
  return { good, book, unit, price };
}

/** Append an order to the book's event stream; returns its index. */
function pushOrder(book, side, price, student) {
  book.events.push({
    kind: "offer",
    side,
    price,
    byId: student.id,
    byName: student.name,
    ts: Date.now(),
    status: "standing",
  });
  return book.events.length - 1;
}

/** The counterparty still has to be able to trade. A resting order whose owner
 *  has since run out is withdrawn rather than executed against. */
function restingIsLive(good, ownerId) {
  const who = session.students[ownerId];
  const unit = who && nextUnit(who, good);
  if (!unit || capacityLeft(who, session.params) <= 0) return null;
  return { who, unit };
}

function handleOffer(peerId, payload) {
  const s = session.students[peerId];
  if (!s) return;
  const v = validateOrder(peerId, s, payload, ROLE.PRODUCER, "sell");
  if (!v) return;
  const { good, book, unit, price } = v;

  // Crossing the standing bid: trade now, at the bid's price.
  const bid = book.bid;
  if (bid && price <= bid.price) {
    const other = restingIsLive(good, bid.buyerId);
    if (!other) {
      book.bid = null;
      return reject(peerId, "That buyer has nothing left — their bid was withdrawn.");
    }
    markEvent(book, bid.eventIndex, "executed");
    markEvent(book, pushOrder(book, "sell", price, s), "executed");
    book.bid = null;   // consumed — off the book before the clear-out below
    return executeTrade(good, s, unit, other.who, other.unit, bid.price);
  }

  const ask = book.ask;
  if (ask && price >= ask.price) {
    return reject(peerId,
      `You must undercut the standing ${goodName(good).toLowerCase()} offer of ${money(ask.price)}.`);
  }
  if (ask) {
    markEvent(book, ask.eventIndex, "beaten");
    if (ask.sellerId !== peerId) {
      reject(ask.sellerId, `${s.name} undercut your ${goodName(good).toLowerCase()} offer at ${money(price)}.`);
    }
  }

  book.seq += 1;
  book.ask = {
    sellerId: peerId, sellerName: s.name, price,
    seq: book.seq, eventIndex: pushOrder(book, "sell", price, s),
  };
  s.lastAction = `asked ${goodName(good)} ${money(price)}`;
  pushLog(session, `${s.name} offers to sell ${goodName(good)} at ${money(price)}`);
  syncAll();
}

function handleBid(peerId, payload) {
  const s = session.students[peerId];
  if (!s) return;
  const v = validateOrder(peerId, s, payload, ROLE.CONSUMER, "buy");
  if (!v) return;
  const { good, book, unit, price } = v;

  // Crossing the standing ask: trade now, at the ask's price.
  const ask = book.ask;
  if (ask && price >= ask.price) {
    const other = restingIsLive(good, ask.sellerId);
    if (!other) {
      book.ask = null;
      return reject(peerId, "That seller has nothing left — their offer was withdrawn.");
    }
    markEvent(book, ask.eventIndex, "executed");
    markEvent(book, pushOrder(book, "buy", price, s), "executed");
    book.ask = null;   // consumed — off the book before the clear-out below
    return executeTrade(good, other.who, other.unit, s, unit, ask.price);
  }

  const bid = book.bid;
  if (bid && price <= bid.price) {
    return reject(peerId,
      `You must beat the standing ${goodName(good).toLowerCase()} bid of ${money(bid.price)}.`);
  }
  if (bid) {
    markEvent(book, bid.eventIndex, "beaten");
    if (bid.buyerId !== peerId) {
      reject(bid.buyerId, `${s.name} outbid your ${goodName(good).toLowerCase()} bid at ${money(price)}.`);
    }
  }

  book.seq += 1;
  book.bid = {
    buyerId: peerId, buyerName: s.name, price,
    seq: book.seq, eventIndex: pushOrder(book, "buy", price, s),
  };
  s.lastAction = `bid ${goodName(good)} ${money(price)}`;
  pushLog(session, `${s.name} offers to buy ${goodName(good)} at ${money(price)}`);
  syncAll();
}

function markEvent(book, index, status) {
  const e = book.events[index];
  if (e) e.status = status;
}

/** Accepting what is already resting — the one-click path, so nobody has to
 *  type a price just to say yes. `side` is the resting order being taken. */
function acceptResting(peerId, payload, side) {
  const taker = session.students[peerId];
  if (!taker) return;
  if (!isRoundOpen(session)) return reject(peerId, "The market is closed.");

  const wantRole = side === "ask" ? ROLE.CONSUMER : ROLE.PRODUCER;
  if (taker.role !== wantRole) {
    return reject(peerId, side === "ask" ? "Only consumers buy." : "Only producers sell.");
  }

  const good = activeGoods(session).includes(payload && payload.good)
    ? payload.good : activeGoods(session)[0];
  const book = session.market.books[good];
  if (!book) return;

  const resting = side === "ask" ? book.ask : book.bid;
  if (!resting) {
    return reject(peerId, side === "ask"
      ? "There is no sell offer on that book." : "There is no buy offer on that book.");
  }
  // Guard against a stale click: the order may have been replaced mid-click.
  if (payload && payload.seq && payload.seq !== resting.seq) {
    return reject(peerId, "That order was replaced. Check the new price.");
  }

  const takerUnit = nextUnit(taker, good);
  if (!takerUnit) return reject(peerId, `No ${goodName(good).toLowerCase()} units left.`);
  if (capacityLeft(taker, session.params) <= 0) {
    return reject(peerId, "You've used your whole capacity this round.");
  }

  const ownerId = side === "ask" ? resting.sellerId : resting.buyerId;
  const other = restingIsLive(good, ownerId);
  if (!other) {
    if (side === "ask") book.ask = null; else book.bid = null;
    return reject(peerId, "The other side has nothing left. That order was withdrawn.");
  }

  markEvent(book, resting.eventIndex, "executed");
  if (side === "ask") book.ask = null; else book.bid = null;   // consumed
  return side === "ask"
    ? executeTrade(good, other.who, other.unit, taker, takerUnit, resting.price)
    : executeTrade(good, taker, takerUnit, other.who, other.unit, resting.price);
}

const handleBuy = (peerId, payload) => acceptResting(peerId, payload, "ask");
const handleSell = (peerId, payload) => acceptResting(peerId, payload, "bid");

/** The single place a trade is booked, whichever way the two sides arrived. */
function executeTrade(good, seller, sellerUnit, buyer, buyerUnit, price) {
  const book = session.market.books[good];
  sellerUnit.price = price;
  buyerUnit.price = price;

  session.market.trades.push({
    good,
    price,
    sellerId: seller.id,
    sellerName: seller.name,
    buyerId: buyer.id,
    buyerName: buyer.name,
    cost: sellerUnit.value,
    value: buyerUnit.value,
    ts: Date.now(),
  });
  book.events.push({
    kind: "trade",
    price,
    sellerName: seller.name,
    buyerName: buyer.name,
    ts: Date.now(),
  });
  // A trade clears both sides: the chart starts a new column and any price may
  // open it again, from either direction. An order that was still resting on
  // the far side is cancelled, not executed — say so on the book and tell the
  // person, rather than leaving it looking live on the chart.
  [["ask", book.ask, "sellerId"], ["bid", book.bid, "buyerId"]].forEach(([side, resting, idKey]) => {
    if (!resting) return;
    markEvent(book, resting.eventIndex, "cleared");
    const ownerId = resting[idKey];
    if (ownerId !== seller.id && ownerId !== buyer.id) {
      reject(ownerId, `Your ${goodName(good).toLowerCase()} ${side === "ask" ? "sell" : "buy"} offer of `
        + `${money(resting.price)} cleared when the trade went through — post again.`);
    }
  });
  book.ask = null;
  book.bid = null;

  // The spillover is real money. Everyone EXCEPT the two people who did the
  // deal pays it; the traders keep their whole gain. That gap is the lesson.
  const e = externalityOf(session, good);
  if (e) {
    let hit = 0;
    studentList(session).forEach((s) => {
      if (s.id === seller.id || s.id === buyer.id) return;
      s.borne += e;
      hit += 1;
    });
    seller.caused += e * hit;
    buyer.caused += e * hit;
    if (hit) {
      Net.broadcast(MSG.TOAST, (peerId) =>
        (peerId === seller.id || peerId === buyer.id || screens.has(peerId))
          ? null
          : { text: `${signedPlain(e)} from a ${goodName(good).toLowerCase()} trade you weren't part of.` });
    }
  }

  seller.lastAction = `sold ${goodName(good)} at ${money(price)}`;
  buyer.lastAction = `bought ${goodName(good)} at ${money(price)}`;
  pushLog(session, `TRADE ${goodName(good)} ${money(price)} — ${seller.name} → ${buyer.name}`
    + (e ? ` · ${signedPlain(e)} to each of ${bystanderCount(session)} bystanders` : ""),
    { toStudents: true });
  syncAll();
}


/* ---------------- phase control ---------------- */

function advancePhase() {
  if (session.phase === PHASE.LOBBY || session.phase === PHASE.BETWEEN) dealRound();
  else if (session.phase === PHASE.READY) openMarket();
  else closeMarket();
}

/** Deal the next round's schedules without opening trading. Students study
 *  their costs and values, and the instructor gets the CE numbers to set
 *  price controls against, before anyone can post. */
function dealRound() {
  session.round += 1;
  session.phase = PHASE.READY;
  session.market = newMarket(activeGoods(session));
  session.endsAt = null;

  // Holding schedules fixed is what makes a shock legible: a price move in the
  // next round is the shock, not the re-roll. But a change of goods or of curve
  // shape has to override it, or the new setting would never take effect.
  const canKeep = session.params.keepSchedules
    && hasSchedules(session)
    && schedulesFit(session)
    && !session.pendingReshape;
  if (canKeep) {
    resetUnitPrices(session);
    pushLog(session, `Round ${session.round} — same schedules as last round`, { toStudents: true });
  } else {
    rollAllSchedules(session);
    pushLog(session, session.params.keepSchedules && hasSchedules(session)
      ? `Round ${session.round} — schedules re-dealt (settings changed)`
      : `Round ${session.round} — schedules dealt`, { toStudents: true });
  }
  session.pendingReshape = false;
  syncAll();
}

function openMarket() {
  session.phase = PHASE.OPEN;
  session.endsAt = session.params.mode === "auto"
    ? Date.now() + session.params.roundLengthSec * 1000
    : null;
  pushLog(session, `Round ${session.round} — market open`, { toStudents: true });
  syncAll();
}

function closeMarket() {
  session.endsAt = null;
  eachBook(session, (book) => { book.ask = null; book.bid = null; });  // resting orders expire
  archiveRound(session);       // keep this round available to the chart picker
  studentList(session).forEach((s) => {
    const net = roundNet(s);          // trading surplus plus what others cost them
    s.totalProfit += net;
    s.history.push({
      round: session.round,
      traded: unitsTraded(s),
      profit: roundProfit(s),
      borne: s.borne || 0,
      caused: s.caused || 0,
      net,
      total: s.totalProfit,
    });
  });
  session.phase = session.round >= session.params.totalRounds ? PHASE.DONE : PHASE.BETWEEN;
  const t = session.market.trades.length;
  // Efficiency is the instructor's number, not the students' — it's on the
  // header tile and the S&D chart. Broadcasting it just told the class the
  // answer before the discussion that's supposed to arrive at it.
  pushLog(session, `Round ${session.round} closed — ${t} trade${t === 1 ? "" : "s"}`,
    { toStudents: true });
  syncAll();
}

function toggleFreeze() {
  if (session.phase === PHASE.OPEN) {
    session.phase = PHASE.PAUSED;
    session.frozenWith = secondsLeft(session);
    session.endsAt = null;
    pushLog(session, "Market frozen", { toStudents: true });
  } else if (session.phase === PHASE.PAUSED) {
    session.phase = PHASE.OPEN;
    if (session.frozenWith != null) session.endsAt = Date.now() + session.frozenWith * 1000;
    pushLog(session, "Market open again", { toStudents: true });
  }
  syncAll();
}

function applyParams() {
  const p = session.params;
  p.totalRounds = clampInt($("t-param-rounds").value, 1, 99, p.totalRounds);
  p.roundLengthSec = clampInt($("t-param-length").value, 10, 3600, p.roundLengthSec);
  p.unitsPerPlayer = clampInt($("t-param-units").value, 1, 8, p.unitsPerPlayer);
  p.mode = document.querySelector('input[name="t-mode"]:checked').value;

  // Market structure, curve shape and externalities. Any change here has to
  // reach the students through a fresh deal, so note it and let dealRound
  // override "keep schedules".
  const shapeBefore = [p.twoGoods, p.supplyLow, p.supplyHigh, p.demandHigh, p.demandLow, p.noise].join();
  const wasTwoGoods = p.twoGoods;
  p.twoGoods = $("t-param-twogoods").checked;
  p.keepSchedules = $("t-param-keep").checked;
  p.supplyLow = clampInt($("t-curve-slow").value, 1, 200, p.supplyLow);
  p.supplyHigh = clampInt($("t-curve-shigh").value, p.supplyLow, 200, p.supplyHigh);
  p.demandHigh = clampInt($("t-curve-dhigh").value, 1, 200, p.demandHigh);
  p.demandLow = clampInt($("t-curve-dlow").value, 1, p.demandHigh, p.demandLow);
  p.noise = clampInt($("t-curve-noise").value, 0, 5, p.noise);

  // Externalities take hold immediately: they price units already traded too,
  // since the spillover happened when the trade happened.
  const extBefore = JSON.stringify(p.externality);
  p.externality = {
    tin: clampSigned($("t-ext-tin").value, -50, 50, 0),
    copper: clampSigned($("t-ext-copper").value, -50, 50, 0),
  };

  if ([p.twoGoods, p.supplyLow, p.supplyHigh, p.demandHigh, p.demandLow, p.noise].join() !== shapeBefore) {
    session.pendingReshape = true;
  }

  pushLog(session, "Setup updated");
  if (p.twoGoods !== wasTwoGoods) {
    pushLog(session, p.twoGoods
      ? "Two goods enabled — takes effect at the next deal"
      : "Back to a single good — takes effect at the next deal");
  }
  if (JSON.stringify(p.externality) !== extBefore) {
    pushLog(session, activeGoods(session)
      .map((g) => `${goodName(g)} externality ${signedMoney(externalityOf(session, g))}/unit`)
      .join(" · "));
  }
  syncAll();
  UI.toast("Setup applied.");
}

/** Price floor and ceiling — separate from setup because these are the ones
 *  you reach for mid-round, and they bite immediately. */
function applyControls() {
  const p = session.params;
  const floor = optionalInt($("t-param-floor").value);
  const ceiling = optionalInt($("t-param-ceiling").value);
  if (floor != null && ceiling != null && floor > ceiling) {
    UI.toast("The floor can't sit above the ceiling — nothing would be legal.");
    return;
  }
  if (floor === p.priceFloor && ceiling === p.priceCeiling) {
    UI.toast("No change to the price controls.");
    return;
  }
  p.priceFloor = floor;
  p.priceCeiling = ceiling;

  pushLog(session, priceControlText(p), { toStudents: true });
  Net.broadcast(MSG.TOAST, { text: priceControlText(p) });
  // A resting order that the new control outlaws can't be left on the book —
  // on either side. A ceiling typically kills asks, a floor typically kills
  // bids, but both are checked against both.
  const illegal = (price) => (floor != null && price < floor) || (ceiling != null && price > ceiling);
  eachBook(session, (book, g) => {
    if (book.ask && illegal(book.ask.price)) {
      pushLog(session, `Standing ${goodName(g).toLowerCase()} sell offer of ${money(book.ask.price)} withdrawn — outside the new limits`,
        { toStudents: true });
      book.ask = null;
    }
    if (book.bid && illegal(book.bid.price)) {
      pushLog(session, `Standing ${goodName(g).toLowerCase()} buy offer of ${money(book.bid.price)} withdrawn — outside the new limits`,
        { toStudents: true });
      book.bid = null;
    }
  });
  syncAll();
  UI.toast("Price controls applied.");
}

function applyPreset(key) {
  const preset = CURVE_PRESETS[key];
  if (!preset) return;
  $("t-curve-slow").value = preset.supplyLow;
  $("t-curve-shigh").value = preset.supplyHigh;
  $("t-curve-dhigh").value = preset.demandHigh;
  $("t-curve-dlow").value = preset.demandLow;
  UI.toast(`${preset.label} loaded — press Apply, then deal a round.`);
}

/* ---------------- the Hayek instruments ---------------- */

/** A cost shock nobody is told about unless the instructor chooses to say so. */
function openShockModal() {
  const goods = activeGoods(session);
  UI.modal({
    kicker: "Instructor",
    title: "Supply shock",
    bodyHtml: `
      <p class="card-note">Adds to the cost of every untraded unit for a share of
      producers. Leave the announcement off and the class sees only the price.</p>
      <div class="row row-fit" style="margin-top:12px;">
        ${goods.length > 1 ? `<div class="field"><label for="shock-good">Good</label>
          <select class="input" id="shock-good">
            ${goods.map((g) => `<option value="${g}">${goodName(g)}</option>`).join("")}
          </select></div>` : `<input type="hidden" id="shock-good" value="${goods[0]}">`}
        <div class="field"><label for="shock-amount">Cost increase</label>
          <input class="input" id="shock-amount" type="number" min="1" step="1" value="6"></div>
        <div class="field"><label for="shock-share">Share of producers hit</label>
          <select class="input" id="shock-share">
            <option value="0.25">A quarter</option>
            <option value="0.5" selected>Half</option>
            <option value="1">All of them</option>
          </select></div>
      </div>
      <label class="check" style="margin-top:12px;">
        <input type="checkbox" id="shock-announce"> Announce it to the class
      </label>`,
    confirmText: "Apply shock",
    onConfirm: () => {
      const good = $("shock-good").value;
      const amount = clampInt($("shock-amount").value, 1, 100, 6);
      const share = Number($("shock-share").value);
      const names = applyShock(session, good, amount, share);
      const announce = $("shock-announce").checked;
      pushLog(session,
        `SHOCK — ${goodName(good)} costs +${money(amount)} for ${names.length} producer${names.length === 1 ? "" : "s"}`
        + (announce ? " (announced)" : " (silent)"));
      if (announce) {
        const text = `Supply disruption: ${goodName(good)} has become more costly to produce.`;
        pushLog(session, text, { toStudents: true });
        Net.broadcast(MSG.TOAST, { text });
      }
      syncAll();
    },
  });
}


function priceControlText(p) {
  if (p.priceFloor == null && p.priceCeiling == null) return "Price controls removed";
  if (p.priceFloor != null && p.priceCeiling != null) {
    return `Price controls: offers must be between ${money(p.priceFloor)} and ${money(p.priceCeiling)}`;
  }
  return p.priceFloor != null
    ? `Price floor: no offers below ${money(p.priceFloor)}`
    : `Price ceiling: no offers above ${money(p.priceCeiling)}`;
}

function rerollSchedules() {
  UI.modal({
    kicker: "Instructor",
    title: "Re-roll every schedule?",
    bodyHtml: '<p class="card-note">Every student gets fresh costs and values. Units already traded this round are cleared.</p>',
    confirmText: "Re-roll",
    onConfirm: () => {
      rollAllSchedules(session);
      session.market = newMarket(activeGoods(session));
      pushLog(session, "Schedules re-rolled", { toStudents: true });
      syncAll();
    },
  });
}

function resetSession() {
  UI.modal({
    kicker: "Instructor",
    title: "Reset this session?",
    bodyHtml: '<p class="card-note">Profits and history are cleared. Students stay connected and drop back to the lobby.</p>',
    confirmText: "Reset",
    onConfirm: () => {
      const keep = studentList(session);
      const params = { ...session.params };
      session = newSessionState(session.code);
      session.params = params;
      session.market = newMarket(activeGoods(session));
      keep.forEach((s) => {
        session.students[s.id] = newStudent(s.id, s.name, s.role);
        session.students[s.id].connected = s.connected;
      });
      pushLog(session, "Session reset", { toStudents: true });
      syncAll();
    },
  });
}

function openBroadcastModal() {
  UI.modal({
    kicker: "Instructor",
    title: "Message the class",
    bodyHtml: '<div class="field"><label for="modal-msg">Message</label><input class="input" id="modal-msg" placeholder="Two minutes left"></div>',
    confirmText: "Send",
    onConfirm: () => {
      const text = $("modal-msg").value.trim();
      if (!text) return false;
      pushLog(session, text, { toStudents: true });
      Net.broadcast(MSG.TOAST, { text });
      syncAll();
    },
  });
}

function openInspector(id) {
  const s = session.students[id];
  if (!s) return;
  const isProducer = s.role === ROLE.PRODUCER;
  const goods = activeGoods(session);
  const tables = goods.map((g) => {
    const units = s.units[g] || [];
    const rows = units.map((u) => `
      <tr>
        <td class="num">${u.n}</td>
        <td class="num">${money(u.value)}</td>
        <td class="num">${u.price === null ? "—" : money(u.price)}</td>
        <td class="num">${signed(unitProfit(s, u))}</td>
      </tr>`).join("");
    return `
      ${goods.length > 1 ? `<div class="card-kicker" style="margin-top:12px;">${goodName(g)}</div>` : ""}
      <table class="table">
        <thead><tr><th>Unit</th><th>${isProducer ? "Cost" : "Value"}</th>
          <th>${isProducer ? "Sold" : "Paid"}</th><th>${isProducer ? "Profit" : "Surplus"}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">No schedule dealt yet.</td></tr>'}</tbody>
      </table>`;
  }).join("");

  UI.modal({
    kicker: isProducer ? "Producer" : "Consumer",
    title: s.name,
    bodyHtml: `${tables}
      <p class="card-note" style="margin-top:12px;">
        Used ${unitsTraded(s)} of ${session.params.unitsPerPlayer} units ·
        session total ${money(s.totalProfit)} · ${s.connected ? "connected" : "offline"}
      </p>`,
    confirmText: `Switch to ${isProducer ? "consumer" : "producer"}`,
    onConfirm: () => {
      s.role = isProducer ? ROLE.CONSUMER : ROLE.PRODUCER;
      // Their old schedule is the wrong side of the market now; re-deal everyone
      // so the aggregate curves stay the shape the instructor asked for.
      rollAllSchedules(session);
      // They're on the other side of the market now; pull whatever they left resting.
      eachBook(session, (book) => {
        if (book.ask && book.ask.sellerId === s.id) book.ask = null;
        if (book.bid && book.bid.buyerId === s.id) book.bid = null;
      });
      pushLog(session, `${s.name} switched to ${s.role} — schedules re-dealt`);
      syncAll();
    },
  });
}

/** Push fresh state to every student and repaint the instructor view. */
function syncAll() {
  // Students get their own slice; projectors get the public one. A screen must
  // never be sent studentView(), which would carry a `me` and the full params.
  Net.broadcast(MSG.STATE, (peerId) => screens.has(peerId) ? null : studentView(session, peerId));
  if (screens.size) {
    const pub = screenView(session);
    screens.forEach((id) => Net.sendTo(id, MSG.SCREEN, pub));
  }
  if (!previewing) saveSession(session);
  UI.renderTeacher(session);
}

/* ================= student ================= */

async function joinSession() {
  const code = $("join-code").value.trim().toUpperCase();
  const name = $("join-name").value.trim();
  if (code.length !== 4 || !name) {
    $("join-error").textContent = "Enter the 4-letter code and your name.";
    return;
  }
  $("btn-join").disabled = true;
  $("btn-join").textContent = "Joining…";
  Net.onStatus = (status) => UI.setConnection(status);
  try {
    await Net.join(code);
    wireClient();
    Net.send(MSG.HELLO, { name });
    UI.showView("student");
    startTicking(() => { if (view) UI.renderStudent(view); });
  } catch (err) {
    $("btn-join").disabled = false;
    $("btn-join").textContent = "Join session";
    $("join-error").textContent = err.message === "no-session"
      ? "No session with that code. Check the letters with your instructor."
      : "Could not connect. Try again.";
  }
}

/* ================= projector ================= */

/** Attach a read-only display. Code only — no name, because it takes no seat. */
async function watchSession() {
  const code = $("watch-code").value.trim().toUpperCase();
  if (code.length !== 4) {
    $("watch-error").textContent = "Enter the 4-letter code.";
    return;
  }
  $("btn-watch").disabled = true;
  $("btn-watch").textContent = "Connecting…";
  Net.onStatus = (status) => UI.setScreenConnection(status);
  try {
    await Net.join(code);
    // No TOAST handler here on purpose: a projector shows the market, not
    // notices addressed to one person.
    Net.on(MSG.SCREEN, (payload) => {
      screenState = payload;
      UI.renderScreen(screenState);
    });
    Net.on(MSG.KICK, () => { location.reload(); });
    Net.send(MSG.WATCH, {});
    UI.showView("screen");
    startTicking(() => { if (screenState) UI.renderScreen(screenState); });
  } catch (err) {
    $("btn-watch").disabled = false;
    $("btn-watch").textContent = "Open display";
    $("watch-error").textContent = err.message === "no-session"
      ? "No session with that code. Check the letters with your instructor."
      : "Could not connect. Try again.";
  }
}

function wireClient() {
  Net.on(MSG.STATE, (payload) => {
    view = payload;
    UI.renderStudent(view);
  });
  Net.on(MSG.TOAST, (payload) => UI.toast(payload.text));
  Net.on(MSG.KICK, () => { location.reload(); });

  // Market blocks are rebuilt per good on every render, so actions are delegated.
  // Four paths: post a price on either side, or accept what's already resting
  // on either side. `postGood` is the typed order, `takeGood` the one click.
  $("s-markets").onclick = (e) => {
    const t = e.target;

    if (t.dataset.postGood) {
      const good = t.dataset.postGood;
      const input = document.getElementById(`s-offer-${good}`);
      const price = Number(input.value);
      if (!Number.isInteger(price) || price <= 0) {
        UI.toast("Prices must be a whole number of dollars.");
        return;
      }
      Net.send(view.me && view.me.role === ROLE.PRODUCER ? MSG.OFFER : MSG.BID, { good, price });
      input.value = "";
      return;
    }

    if (t.dataset.takeGood) {
      const good = t.dataset.takeGood;
      const book = view.market.books[good];
      if (!book) return;
      const isProducer = view.me && view.me.role === ROLE.PRODUCER;
      // A producer accepts the resting bid; a consumer accepts the resting ask.
      const resting = isProducer ? book.bid : book.ask;
      if (!resting) return;
      Net.send(isProducer ? MSG.SELL : MSG.BUY, { good, seq: resting.seq });
      t.disabled = true;
    }
  };
}

/* ================= shared ================= */

/** One timer drives both dashboards: clock text, and auto-close on the host. */
function startTicking(render) {
  if (tick) clearInterval(tick);
  tick = setInterval(() => {
    if (session && session.phase === PHASE.OPEN && session.endsAt && secondsLeft(session) === 0) {
      closeMarket();
      return;
    }
    render();
  }, 1000);
  render();
}

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Signed and fractional. Prices are whole dollars, but a per-person spillover
 *  must not be: with 20 students, $1 each is $18 a unit socially, which swamps
 *  every trade. Quarters give the instructor somewhere to stand. */
function clampSigned(raw, min, max, fallback) {
  const n = Math.round(parseFloat(raw) * 4) / 4;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Same glyphs as the student dashboard uses, so a number reads identically
 *  on both screens. */
function signedMoney(n) { return signedPlain(n); }

/** Blank field means "no control", not zero. */
function optionalInt(raw) {
  if (String(raw).trim() === "") return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/* ================= preview mode =================
 * ?preview=teacher or ?preview=student renders a dashboard with a fake market
 * mid-round — no networking — so the layouts can be checked without a class.
 */

function startPreview(which) {
  previewing = true;
  const q = new URLSearchParams(location.search);
  session = newSessionState("DEMO");
  session.phase = PHASE.OPEN;
  session.endsAt = Date.now() + 132000;
  if (q.get("goods") === "2") session.params.twoGoods = true;

  // A full-size class, so the roster pager and the S&D curves have real shape.
  ["Ostrom", "Coase", "Hayek", "Sen", "Smith", "Robinson", "Marshall", "Pigou",
   "Veblen", "Keynes", "Ricardo", "Malthus", "Mill", "Walras", "Menger",
   "Knight", "Friedman", "Tobin", "Arrow", "Solow"].forEach((name, i) => {
    const role = i % 2 === 0 ? ROLE.PRODUCER : ROLE.CONSUMER;
    const s = newStudent(`peer-${i}`, `Team ${name}`, role);
    s.totalProfit = 6 + (i % 7) * 3;
    s.connected = i !== 5;
    session.students[s.id] = s;
  });

  // Bid down to a trade, repeatedly, using whatever prices are actually legal —
  // schedules are random, so the script can't hard-code them.
  const goods = activeGoods(session);
  const producers = ["peer-0", "peer-2", "peer-4", "peer-6", "peer-8"];
  const consumers = ["peer-1", "peer-3", "peer-5", "peer-7", "peer-9"];
  // Both sides walk toward each other, then one of them crosses — so the
  // preview shows the two ladders and a trade, not a one-sided slide.
  const runTrades = (count) => {
    for (let t = 0; t < count; t++) {
      const good = goods[t % goods.length];
      const book = session.market.books[good];
      const top = 20 - t;

      producers.slice(0, 3).forEach((p) => {
        const s = session.students[p];
        if (!nextUnit(s, good) || capacityLeft(s, session.params) <= 0) return;
        const want = book.ask ? book.ask.price - 1 : top;
        if (want > 0) handleOffer(p, { good, price: want });
      });
      consumers.slice(0, 3).forEach((c) => {
        const s = session.students[c];
        if (!nextUnit(s, good) || capacityLeft(s, session.params) <= 0) return;
        // Climb, but stop short of the ask so the bid rests instead of crossing.
        const floorBid = book.bid ? book.bid.price + 1 : Math.max(1, top - 6);
        if (book.ask && floorBid >= book.ask.price) return;
        handleBid(c, { good, price: floorBid });
      });

      // Close it by accepting, alternating which side reaches across.
      if (t % 2 === 0 && book.ask) {
        handleBuy(consumers[t % consumers.length], { good, seq: book.ask.seq });
      } else if (book.bid) {
        handleSell(producers[t % producers.length], { good, seq: book.bid.seq });
      } else if (book.ask) {
        handleBuy(consumers[t % consumers.length], { good, seq: book.ask.seq });
      }
    }
  };

  for (let r = 1; r <= 2; r++) {
    session.round = r;
    session.market = newMarket(goods);
    rollAllSchedules(session);
    runTrades(3);
    archiveRound(session);
  }
  session.round = 3;
  session.market = newMarket(goods);
  rollAllSchedules(session);
  runTrades(2);
  pushLog(session, "Round 3 — market open", { toStudents: true });

  if (which === "screen") {
    // Leave orders resting on both sides so the projected book isn't empty.
    goods.forEach((g, i) => {
      handleOffer(producers[i % producers.length], { good: g, price: 17 - i });
      handleBid(consumers[i % consumers.length], { good: g, price: 11 - i });
    });
    screenState = screenView(session);
    UI.showView("screen");
    UI.setScreenConnection("live");
    startTicking(() => UI.renderScreen(screenState));
  } else if (which === "student") {
    // ?role=consumer previews the buying side of the same market.
    const as = new URLSearchParams(location.search).get("role") === "consumer" ? "peer-1" : "peer-0";
    view = studentView(session, as);
    UI.showView("student");
    UI.setConnection("live");
    startTicking(() => UI.renderStudent(view));
  } else {
    bindTeacherControls();
    syncParamInputs();
    UI.showView("teacher");
    startTicking(() => UI.renderTeacher(session));
  }
}
