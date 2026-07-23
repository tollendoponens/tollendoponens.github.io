/* Transport — teacher tab is the server.
 *
 * GitHub Pages serves static files only, so there is no backend to talk to.
 * The instructor's tab holds authoritative state and every student connects to
 * it over WebRTC via PeerJS's free public broker. Same pattern as
 * classroom-market-sim; this file is the plumbing only — no game rules.
 *
 * Wire format:  { v:1, type:"…", from:"host"|<peerId>, ts:<epoch>, payload:{} }
 */
"use strict";

const PEER_PREFIX = "csim-template-";   // change per deployment so codes don't collide
const PROTOCOL_VERSION = 1;
const HEARTBEAT_MS = 5000;

/** Message types. Add simulation messages under the SIM banner. */
const MSG = {
  // host -> student
  STATE: "state",        // full studentView() snapshot
  TOAST: "toast",        // transient notice
  KICK: "kick",
  // student -> host
  HELLO: "hello",
  PING: "ping",
  OFFER: "offer",        // producer posts a sell offer: { good, price }
  BUY: "buy",            // consumer accepts a standing offer: { good, seq }
};

const Net = {
  role: null,            // "host" | "client"
  peer: null,
  id: null,
  code: null,
  conns: new Map(),      // host: peerId -> DataConnection
  hostConn: null,        // client: connection to host
  handlers: {},          // type -> fn(payload, fromId)
  onStatus: () => {},    // (status:"connecting"|"live"|"lost", detail) => void

  on(type, fn) { this.handlers[type] = fn; return this; },

  _dispatch(msg, fromId) {
    if (!msg || msg.v !== PROTOCOL_VERSION) return;
    const fn = this.handlers[msg.type];
    if (fn) fn(msg.payload, fromId);
  },

  _envelope(type, payload) {
    return { v: PROTOCOL_VERSION, type, from: this.id || "host", ts: Date.now(), payload };
  },

  /* ---------------- host ---------------- */

  /** Start hosting. Returns a promise resolving to the 4-letter session code. */
  host(preferredCode) {
    this.role = "host";
    return new Promise((resolve, reject) => {
      const attempt = (code) => {
        const peer = new Peer(PEER_PREFIX + code, { debug: 1 });
        peer.on("open", () => {
          this.peer = peer;
          this.id = "host";
          this.code = code;
          peer.on("connection", (conn) => this._acceptClient(conn));
          this.onStatus("live", code);
          resolve(code);
        });
        peer.on("error", (err) => {
          // Code already taken — roll another one and retry.
          if (err.type === "unavailable-id" && !preferredCode) {
            peer.destroy();
            attempt(randomCode());
          } else {
            this.onStatus("lost", err.type);
            reject(err);
          }
        });
      };
      attempt(preferredCode || randomCode());
    });
  },

  _acceptClient(conn) {
    conn.on("open", () => {
      this.conns.set(conn.peer, conn);
      conn.on("data", (msg) => this._dispatch(msg, conn.peer));
    });
    const drop = () => {
      this.conns.delete(conn.peer);
      const fn = this.handlers.__disconnect;
      if (fn) fn(conn.peer);
    };
    conn.on("close", drop);
    conn.on("error", drop);
  },

  /** Host: called when a student's connection drops. */
  onDisconnect(fn) { this.handlers.__disconnect = fn; return this; },

  sendTo(peerId, type, payload) {
    const conn = this.conns.get(peerId);
    if (conn && conn.open) conn.send(this._envelope(type, payload));
  },

  broadcast(type, payloadFor) {
    // payloadFor may be a value or a fn(peerId) — students get different slices.
    // Returning null from the function skips that peer entirely.
    this.conns.forEach((conn, peerId) => {
      if (!conn.open) return;
      const payload = typeof payloadFor === "function" ? payloadFor(peerId) : payloadFor;
      if (payload == null) return;
      conn.send(this._envelope(type, payload));
    });
  },

  /* ---------------- client ---------------- */

  /** Join a session. Resolves once the data channel is open. */
  join(code) {
    this.role = "client";
    this.code = code.toUpperCase();
    this.onStatus("connecting");
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      peer.on("open", (id) => {
        this.peer = peer;
        this.id = id;
        const conn = peer.connect(PEER_PREFIX + this.code, { reliable: true });
        const failTimer = setTimeout(() => reject(new Error("no-session")), 12000);
        conn.on("open", () => {
          clearTimeout(failTimer);
          this.hostConn = conn;
          this.onStatus("live");
          conn.on("data", (msg) => this._dispatch(msg, "host"));
          conn.on("close", () => this.onStatus("lost"));
          setInterval(() => this.send(MSG.PING, {}), HEARTBEAT_MS);
          resolve(conn);
        });
        conn.on("error", (err) => { clearTimeout(failTimer); reject(err); });
      });
      peer.on("error", (err) => {
        this.onStatus("lost", err.type);
        reject(err);
      });
    });
  },

  send(type, payload) {
    if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(this._envelope(type, payload));
    }
  },
};

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O — misread on projectors
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
}
