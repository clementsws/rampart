import { DurableObject } from 'cloudflare:workers';
import { AI_NAMES, DEFAULT_ROUNDS, FACTIONS, TICK, validFaction } from '../shared/constants';
import { Game } from '../shared/engine';
import { ClientMsg, Encoder, LobbyInfo, ServerMsg, encodeStatic } from '../shared/protocol';
import { Difficulty } from '../shared/types';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

interface Slot {
  kind: 'open' | 'human' | 'ai';
  name: string;
  difficulty: Difficulty;
  faction: number;
  token: string;
  connected: boolean;
  /** When a human dropped out (ms), for the grace period before a CPU takes over. */
  leftAt: number;
}

interface Client {
  token: string;
  slot: number;
  /** Simple flood protection: message budget refilled over time. */
  budget: number;
  lastRefill: number;
}

const MAX_SLOTS = 4;
const AUTOPILOT_GRACE_MS = 5000;
const LOBBY_GRACE_MS = 30000;
const IDLE_SHUTDOWN_MS = 90000;
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

const openSlot = (): Slot => ({ kind: 'open', name: '', difficulty: 'normal', faction: 0, token: '', connected: false, leftAt: 0 });

function cleanName(v: unknown): string {
  const s = String(v ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
  return s || 'Knight';
}

function newToken(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** One Durable Object per room code: lobby, authoritative game simulation and WebSocket fan-out. */
export class GameRoom extends DurableObject<Env> {
  private code = '';
  private clients = new Map<WebSocket, Client>();
  private slots: Slot[] = Array.from({ length: MAX_SLOTS }, openSlot);
  private host = -1;
  private rounds = DEFAULT_ROUNDS;
  private game: Game | null = null;
  private encoder: Encoder | null = null;
  /** pid -> slot index for the running game. */
  private gameSlots: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStep = 0;
  private acc = 0;
  private emptySince = 0;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const m = new URL(request.url).pathname.match(/\/api\/room\/([A-Z0-9]+)\/ws$/i);
    if (m) this.code = m[1].toUpperCase();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.clients.set(server, { token: '', slot: -1, budget: 60, lastRefill: Date.now() });
    server.addEventListener('message', (ev) => this.onMessage(server, ev.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    this.ensureTimer();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------ messaging

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already gone */
    }
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.keys()) {
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private lobbyInfo(): LobbyInfo {
    return {
      code: this.code,
      slots: this.slots.map((s) => ({ kind: s.kind, name: s.name, difficulty: s.difficulty, faction: s.faction, connected: s.connected })),
      host: this.host,
      rounds: this.rounds,
      inGame: !!this.game,
    };
  }

  private broadcastLobby() {
    const lobby = this.lobbyInfo();
    for (const [ws, c] of this.clients) this.send(ws, { t: 'lobby', lobby, you: c.slot });
  }

  private pidOf(slot: number): number {
    return this.gameSlots.indexOf(slot);
  }

  private sendInit(ws: WebSocket, slot: number) {
    if (!this.game || !this.encoder) return;
    this.send(ws, { t: 'init', you: this.pidOf(slot), map: encodeStatic(this.game.s), state: this.encoder.full() });
  }

  private onMessage(ws: WebSocket, data: unknown) {
    const c = this.clients.get(ws);
    if (!c || typeof data !== 'string' || data.length > 4096) return;
    const now = Date.now();
    c.budget = Math.min(80, c.budget + ((now - c.lastRefill) / 1000) * 60);
    c.lastRefill = now;
    if (c.budget < 1) return;
    c.budget--;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello':
        return this.onHello(ws, c, msg.name, msg.token, msg.faction);
      case 'ping':
        return this.send(ws, { t: 'pong', c: Number(msg.c) || 0, time: this.game ? this.game.s.time : 0 });
      case 'a': {
        if (!this.game || c.slot < 0) return;
        const pid = this.pidOf(c.slot);
        if (pid >= 0) this.game.act(pid, msg.a);
        return;
      }
      case 'slot': {
        if (c.slot !== this.host || this.game) return;
        const i = Number(msg.slot);
        const slot = this.slots[i];
        if (!slot || slot.kind === 'human') return;
        if (msg.kind === 'ai') {
          const difficulty = DIFFS.includes(msg.difficulty as Difficulty) ? (msg.difficulty as Difficulty) : 'normal';
          const faction = slot.kind === 'ai' ? slot.faction : this.unusedFaction();
          this.slots[i] = { ...openSlot(), kind: 'ai', name: AI_NAMES[i], difficulty, faction, connected: true };
        } else {
          this.slots[i] = openSlot();
        }
        return this.broadcastLobby();
      }
      case 'faction': {
        // Players pick their own faction; the host also decides for the computer players.
        const i = Number(msg.slot);
        const slot = this.slots[i];
        if (!slot || this.game || (i !== c.slot && !(c.slot === this.host && slot.kind === 'ai'))) return;
        if (slot.kind === 'open') return;
        slot.faction = validFaction(msg.faction);
        return this.broadcastLobby();
      }
      case 'rounds': {
        if (c.slot !== this.host || this.game) return;
        const r = Math.round(Number(msg.rounds));
        if (r >= 3 && r <= 20) this.rounds = r;
        return this.broadcastLobby();
      }
      case 'start':
        if (c.slot !== this.host || this.game) return;
        return this.startGame();
      case 'lobby':
        if (c.slot !== this.host || !this.game || this.game.s.phase !== 'gameover') return;
        this.game = null;
        this.encoder = null;
        this.gameSlots = [];
        for (let i = 0; i < MAX_SLOTS; i++) {
          const s = this.slots[i];
          if (s.kind === 'human' && !s.connected) this.slots[i] = openSlot();
        }
        return this.broadcastLobby();
    }
  }

  private unusedFaction(): number {
    const used = new Set(this.slots.filter((s) => s.kind !== 'open').map((s) => s.faction));
    const free = FACTIONS.map((_, i) => i).filter((f) => !used.has(f));
    const pool = free.length ? free : FACTIONS.map((_, i) => i);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private onHello(ws: WebSocket, c: Client, name: string, token: string, faction: unknown) {
    if (c.token) return; // one seat per connection
    const existing = token ? this.slots.findIndex((s) => s.kind === 'human' && s.token === token) : -1;
    if (existing >= 0) {
      // Reconnection: take the slot back from the autopilot.
      const s = this.slots[existing];
      for (const [other, oc] of this.clients) {
        if (other !== ws && oc.slot === existing) {
          oc.slot = -1;
          try {
            other.close(4000, 'replaced');
          } catch {
            /* ignore */
          }
          this.clients.delete(other);
        }
      }
      s.connected = true;
      s.leftAt = 0;
      s.name = cleanName(name);
      c.token = s.token;
      c.slot = existing;
      if (this.game) {
        const pid = this.pidOf(existing);
        if (pid >= 0) {
          this.game.setAI(pid, false);
          this.game.s.players[pid].connected = true;
        }
      }
    } else {
      c.token = token && /^[a-f0-9]{24}$/.test(token) ? token : newToken();
      c.slot = -1;
      if (!this.game) {
        const free = this.slots.findIndex((s) => s.kind === 'open');
        if (free >= 0) {
          this.slots[free] = {
            kind: 'human',
            name: cleanName(name),
            difficulty: 'normal',
            faction: faction === undefined ? this.unusedFaction() : validFaction(faction),
            token: c.token,
            connected: true,
            leftAt: 0,
          };
          c.slot = free;
        }
      }
    }
    if (this.host < 0 || this.slots[this.host].kind !== 'human' || !this.slots[this.host].connected) {
      if (c.slot >= 0) this.host = c.slot;
    }
    this.send(ws, { t: 'welcome', token: c.token, slot: c.slot });
    this.broadcastLobby();
    if (this.game) this.sendInit(ws, c.slot);
  }

  private onClose(ws: WebSocket) {
    const c = this.clients.get(ws);
    if (!c) return;
    this.clients.delete(ws);
    if (c.slot >= 0) {
      const s = this.slots[c.slot];
      if (s.kind === 'human' && s.token === c.token) {
        s.connected = false;
        s.leftAt = Date.now();
        if (this.game) {
          const pid = this.pidOf(c.slot);
          if (pid >= 0) this.game.s.players[pid].connected = false;
        }
      }
      if (this.host === c.slot) this.pickHost();
    }
    this.broadcastLobby();
  }

  private pickHost() {
    const i = this.slots.findIndex((s) => s.kind === 'human' && s.connected);
    this.host = i;
  }

  // ---------------------------------------------------------------- game

  private startGame() {
    const seats = this.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'open');
    if (seats.length < 2) return;
    this.gameSlots = seats.map(({ i }) => i);
    this.game = new Game({
      mode: 'versus',
      rounds: this.rounds,
      players: seats.map(({ s }) => ({ name: s.name, ai: s.kind === 'ai' || !s.connected, difficulty: s.difficulty, faction: s.faction })),
    });
    this.encoder = new Encoder(this.game);
    this.game.drainEvents();
    this.broadcastLobby();
    for (const [ws, c] of this.clients) this.sendInit(ws, c.slot);
    this.lastStep = Date.now();
    this.acc = 0;
  }

  private ensureTimer() {
    if (this.timer) return;
    this.lastStep = Date.now();
    this.timer = setInterval(() => this.step(), TICK * 1000);
  }

  private step() {
    const now = Date.now();
    const elapsed = Math.min(0.25, (now - this.lastStep) / 1000);
    this.lastStep = now;

    // Humans who dropped out: hand them to the autopilot (in game) or free the seat (in lobby).
    let lobbyChanged = false;
    this.slots.forEach((s, i) => {
      if (s.kind !== 'human' || s.connected || !s.leftAt) return;
      if (this.game) {
        const pid = this.pidOf(i);
        if (pid >= 0 && !this.game.s.players[pid].ai && now - s.leftAt > AUTOPILOT_GRACE_MS) this.game.setAI(pid, true);
      } else if (now - s.leftAt > LOBBY_GRACE_MS) {
        this.slots[i] = openSlot();
        lobbyChanged = true;
      }
    });
    if (lobbyChanged) {
      if (this.host >= 0 && this.slots[this.host].kind !== 'human') this.pickHost();
      this.broadcastLobby();
    }

    if (this.game && this.encoder) {
      this.acc += elapsed;
      let steps = 0;
      while (this.acc >= TICK && steps < 5) {
        this.game.tick(TICK);
        this.acc -= TICK;
        steps++;
      }
      if (steps) {
        // Always consume the delta so dirty tiles and events don't pile up while nobody is connected.
        const delta = this.encoder.delta();
        if (this.clients.size) this.broadcast(delta);
      }
    }

    if (this.clients.size === 0) {
      if (!this.emptySince) this.emptySince = now;
      if (now - this.emptySince > IDLE_SHUTDOWN_MS) this.shutdown();
    } else {
      this.emptySince = 0;
    }
  }

  private shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.game = null;
    this.encoder = null;
    this.gameSlots = [];
    this.slots = Array.from({ length: MAX_SLOTS }, openSlot);
    this.host = -1;
    this.emptySince = 0;
  }
}
