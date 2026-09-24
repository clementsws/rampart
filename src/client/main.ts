import {
  ACHIEVEMENTS,
  GameKind,
  HAT_NAMES,
  Reward,
  TITLES,
  TRAIL_NAMES,
  achievement,
  cpuLook,
  isUnlocked,
  recordFor,
  styledName,
  unlockedBy,
} from '../shared/career';
import { AI_NAMES, FACTIONS, PLAYER_COLORS, SOLO_LEVELS, levelDef, validFaction } from '../shared/constants';
import { GameConfig } from '../shared/engine';
import { LobbyInfo, ServerMsg } from '../shared/protocol';
import { Difficulty, EXECUTIONS, GameEvent, GameState, HATS, Look, Player, TRAILS } from '../shared/types';
import { AccountClient } from './account';
import { buzz, sfx } from './audio';
import { Beat, ExecutionScene, FATES, Mood, PIRATE_ADMIRAL, drawFigurePreview, figureFor, portraitUrl } from './execution';
import { Controller, TouchMode } from './input';
import { FATE_FACTS, buildCall, nextFact, readyCall } from './lore';
import { Net } from './net';
import { Renderer, drawPiecePreview } from './render';
import { LocalSession, OnlineSession, Session } from './session';
import { drawFactionPreview } from './sprites';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ settings

const store = {
  get(k: string, d = ''): string {
    try {
      return localStorage.getItem('rampart.' + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem('rampart.' + k, v);
    } catch {
      /* private mode */
    }
  },
};

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

const settings = {
  name: store.get('name'),
  sound: store.get('sound', 'on'),
  touch: store.get('touch', 'drag') as TouchMode,
  faction: validFaction(store.get('faction', '0')),
  campDiff: (DIFFS.find((d) => d === store.get('campDiff')) ?? 'normal') as Difficulty,
  campMode: store.get('campMode', 'campaign') === 'endless' ? 'endless' : 'campaign',
};

interface Best {
  score: number;
  level: number;
  wave: number;
  won: boolean;
}

const bestKey = (mode: string, diff: string) => `best.${mode}.${diff}`;

function loadBest(mode: string, diff: string): Best | null {
  try {
    const b = JSON.parse(store.get(bestKey(mode, diff), 'null'));
    return b && typeof b.score === 'number' ? b : null;
  } catch {
    return null;
  }
}

const account = new AccountClient();

function playerName(): string {
  // Signed-in commanders always play under their account name.
  if (account.signedIn) return account.profile!.name;
  const v = ($<HTMLInputElement>('in-name').value || '').trim().slice(0, 16);
  if (v !== settings.name) {
    settings.name = v;
    store.set('name', v);
  }
  return v || 'Knight';
}

// --------------------------------------------------------------------- setup

const canvas = $<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const ctrl = new Controller(canvas, renderer);
ctrl.touchMode = settings.touch;
sfx.muted = settings.sound === 'off';

let session: Session | null = null;
let demo = true;
let localConfig: GameConfig | null = null;
let net: Net | null = null;
let lobby: LobbyInfo | null = null;
let mySlot = -1;
let screenStack: string[] = [];
let execScene: ExecutionScene | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
/** Id of the local game being played, and whether its result has been saved. */
let localGameId = '';
let recorded = false;

function startDemo() {
  demo = true;
  const s = new LocalSession(
    {
      mode: 'versus',
      rounds: 99,
      players: [
        { name: 'Blue', ai: true, difficulty: 'normal' },
        { name: 'Red', ai: true, difficulty: 'normal' },
      ],
    },
    -1,
  );
  setSession(s);
}

function setSession(s: Session | null) {
  session = s;
  ctrl.setSession(s && !demo ? s : null);
  lastPhaseKey = '';
  firingShown = false;
  fillHints = 0;
  hideGameOver();
  buildChips();
}

// ------------------------------------------------------------------- screens

function show(id: string | null) {
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => (el.hidden = el.id !== id));
  $('screens').classList.toggle('off', !id);
  if (id) $(id).querySelectorAll<HTMLElement>('[data-lore]').forEach((el) => (el.textContent = nextFact()));
  if (id) {
    const top = screenStack[screenStack.length - 1];
    if (top !== id) screenStack.push(id);
  } else screenStack = [];
}

function back() {
  screenStack.pop();
  const prev = screenStack.pop() ?? (session && !demo ? null : 'screen-home');
  show(prev);
}

function enterGame() {
  demo = false;
  show(null);
  $('hud').hidden = false;
  document.body.classList.add('ingame');
  ctrl.setSession(session);
  renderer.zoomBuild = null;
  renderer.zoomCombat = false;
  buildChips();
  requestWakeLock();
  tryFullscreen();
}

function leaveGame() {
  recordLocalGame();
  $('hud').hidden = true;
  document.body.classList.remove('ingame');
  hideGameOver();
  releaseWakeLock();
  if (net) {
    net.close();
    net = null;
  }
  lobby = null;
  mySlot = -1;
  localConfig = null;
  history.replaceState(null, '', location.pathname);
  startDemo();
  show('screen-home');
}

function toast(msg: string, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => (t.hidden = true), ms);
}

async function requestWakeLock() {
  try {
    const nav = navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* not available */
  }
}

function releaseWakeLock() {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

function tryFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (!matchMedia('(pointer: coarse)').matches || document.fullscreenElement) return;
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    if (p && typeof p.then === 'function') {
      p.then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o?.lock?.('landscape').catch(() => undefined);
      }).catch(() => undefined);
    }
  } catch {
    /* unsupported (iOS) */
  }
}

// ---------------------------------------------------------------- local games

function startLocal(cfg: GameConfig) {
  recordLocalGame();
  recorded = false;
  localConfig = cfg;
  localGameId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  setSession(new LocalSession(cfg, 0));
  enterGame();
}

function startCampaign() {
  startLocal({
    mode: 'solo',
    campaign: { difficulty: settings.campDiff, endless: settings.campMode === 'endless' },
    players: [{ name: playerName(), ai: false, difficulty: 'normal', faction: settings.faction, look: account.look }],
  });
}

const DIFF_NOTES: Record<Difficulty, string> = {
  easy: 'Smaller waves and clumsy gunners. Good for learning the ropes.',
  normal: 'Ships attack in waves. Galleons fire broadsides from level 5, and the pirate flagship leads the final assault.',
  hard: 'Big waves, sharp-eyed gunners, broadsides from level 3 and a flagship every third level. Good luck.',
};

function updateCampaignScreen() {
  $('camp-diff-note').textContent = DIFF_NOTES[settings.campDiff];
  $('camp-mode-note').textContent =
    settings.campMode === 'endless' ? 'The waves never stop. How long can your walls hold?' : 'Six levels. Sink every ship to win.';
  const b = loadBest(settings.campMode, settings.campDiff);
  $('camp-best').textContent = b
    ? `Your best: ${b.score.toLocaleString()} points · ${b.won ? '👑 victory' : `reached level ${b.level}, wave ${Math.max(1, b.wave)}`}`
    : 'No record yet on this setting.';
}

/** Faction choice on the home screen: a little fort in each faction's style. */
function buildFactionPicker() {
  const wrap = $('faction-pick');
  wrap.innerHTML = '';
  FACTIONS.forEach((f, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${f.name}: ${f.castle}`;
    b.classList.toggle('on', i === settings.faction);
    const c = document.createElement('canvas');
    drawFactionPreview(c, renderer.sprites, i, 0);
    const label = document.createElement('span');
    label.textContent = f.name;
    b.append(c, label);
    b.onclick = () => {
      settings.faction = i;
      store.set('faction', String(i));
      wrap.querySelectorAll('button').forEach((x, k) => x.classList.toggle('on', k === i));
      updateFactionName();
      if (lobby && mySlot >= 0) net?.send({ t: 'faction', slot: mySlot, faction: i });
    };
    wrap.append(b);
  });
  updateFactionName();
}

function updateFactionName() {
  const f = FACTIONS[settings.faction];
  $('faction-name').textContent = `${f.crest} ${f.name} · ${f.castle}`;
}

const segValue = (name: string) => document.querySelector<HTMLElement>(`.seg[data-seg="${name}"] .on`)?.dataset.v ?? '';

function startBattle() {
  const n = Number(segValue('opponents')) || 1;
  const difficulty = (segValue('difficulty') || 'normal') as Difficulty;
  const rounds = Number(segValue('rounds')) || 8;
  const players: GameConfig['players'] = [{ name: playerName(), ai: false, difficulty, faction: settings.faction, look: account.look }];
  for (let i = 1; i <= n; i++) players.push({ name: AI_NAMES[i], ai: true, difficulty, look: cpuLook(i, difficulty) });
  startLocal({ mode: 'versus', rounds, players });
}

// ---------------------------------------------------------------- online play

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function joinRoom(code: string) {
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (code.length < 4) {
    toast('Enter a room code (4+ letters)');
    return;
  }
  if (net) net.close();
  lobby = null;
  mySlot = -1;
  history.replaceState(null, '', `?room=${code}`);
  net = new Net(
    code,
    () => ({ t: 'hello', name: playerName(), token: store.get('token.' + code), faction: settings.faction, auth: account.token || undefined }),
    (m) => onServer(code, m),
    (ok) => {
      $('net-status').hidden = ok;
      if (!ok && !lobby) $('lobby-status').textContent = 'Connecting…';
    },
  );
  $('lobby-code').textContent = code;
  $('lobby-slots').innerHTML = '';
  $('lobby-status').textContent = 'Connecting…';
  show('screen-lobby');
}

function onServer(code: string, m: ServerMsg) {
  switch (m.t) {
    case 'welcome':
      store.set('token.' + code, m.token);
      mySlot = m.slot;
      break;
    case 'lobby':
      lobby = m.lobby;
      mySlot = m.you;
      renderLobby();
      if (!m.lobby.inGame && session instanceof OnlineSession) {
        // Host took everyone back to the lobby.
        $('hud').hidden = true;
        document.body.classList.remove('ingame');
        startDemo();
        show('screen-lobby');
      }
      break;
    case 'init':
      setSession(
        new OnlineSession(m.map, m.state, m.you, (a) => net?.send({ t: 'a', a })),
      );
      enterGame();
      break;
    case 's':
      if (session instanceof OnlineSession) session.apply(m);
      break;
    case 'error':
      toast(m.msg);
      break;
    case 'honours':
      showHonours(m.ids);
      void account.refresh();
      break;
    case 'pong':
      break;
  }
}

function renderLobby() {
  if (!lobby) return;
  const isHost = lobby.host === mySlot && mySlot >= 0;
  const wrap = $('lobby-slots');
  wrap.innerHTML = '';
  lobby.slots.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'slot';
    // Seated commanders get a portrait in their hat; an open seat is an empty frame.
    let dot: HTMLElement;
    if (s.kind === 'open') {
      dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.border = `2px solid ${PLAYER_COLORS[i]}`;
    } else {
      const img = document.createElement('img');
      img.className = 'av';
      img.alt = '';
      img.src = portraitUrl(PLAYER_COLORS[i], HATS.includes(s.hat) ? s.hat : 'crown');
      img.style.borderColor = PLAYER_COLORS[i];
      dot = img;
    }
    const name = document.createElement('span');
    name.className = 'name';
    const tags: string[] = [];
    if (s.kind !== 'open') {
      name.textContent = s.name;
      if (s.title) {
        const t = document.createElement('span');
        t.className = 'ttl';
        t.textContent = ` ${s.title}`;
        name.appendChild(t);
      }
    }
    if (s.kind === 'human') {
      if (i === lobby!.host) tags.push('host');
      if (i === mySlot) tags.push('you');
      if (!s.connected) tags.push('offline');
    } else if (s.kind === 'ai') {
      tags.push('CPU');
    } else {
      name.textContent = 'Open seat';
      name.style.color = 'var(--muted)';
    }
    if (tags.length) {
      const t = document.createElement('span');
      t.className = 'tag2';
      t.textContent = ` (${tags.join(', ')})`;
      name.appendChild(t);
    }
    row.append(dot, name);
    if (s.kind !== 'open') {
      // Faction badge: tap your own (or, as host, a computer's) to switch faction.
      const f = FACTIONS[s.faction] ?? FACTIONS[0];
      const fb = document.createElement('button');
      fb.className = 'fac';
      fb.textContent = `${f.crest} ${f.name}`;
      fb.title = f.castle;
      const mine = i === mySlot || (isHost && s.kind === 'ai');
      fb.disabled = !mine || lobby!.inGame;
      fb.onclick = () => {
        const next = (s.faction + 1) % FACTIONS.length;
        if (i === mySlot) {
          settings.faction = next;
          store.set('faction', String(next));
          buildFactionPicker();
        }
        net?.send({ t: 'faction', slot: i, faction: next });
      };
      row.append(fb);
    }
    if (isHost && !lobby!.inGame) {
      if (s.kind === 'open') {
        const b = document.createElement('button');
        b.textContent = '+ CPU';
        b.onclick = () => net?.send({ t: 'slot', slot: i, kind: 'ai', difficulty: 'normal' });
        row.append(b);
      } else if (s.kind === 'ai') {
        const sel = document.createElement('select');
        for (const d of ['easy', 'normal', 'hard']) {
          const o = document.createElement('option');
          o.value = d;
          o.textContent = d[0].toUpperCase() + d.slice(1);
          o.selected = d === s.difficulty;
          sel.append(o);
        }
        sel.onchange = () => net?.send({ t: 'slot', slot: i, kind: 'ai', difficulty: sel.value as Difficulty });
        const x = document.createElement('button');
        x.textContent = '✕';
        x.setAttribute('aria-label', 'Remove CPU');
        x.onclick = () => net?.send({ t: 'slot', slot: i, kind: 'open' });
        row.append(sel, x);
      }
    } else if (s.kind === 'ai') {
      const d = document.createElement('span');
      d.className = 'tag2';
      d.textContent = s.difficulty;
      row.append(d);
    }
    wrap.append(row);
  });
  const filled = lobby.slots.filter((s) => s.kind !== 'open').length;
  const seg = document.querySelector<HTMLElement>('.seg[data-seg="lobby-rounds"]')!;
  seg.classList.toggle('locked', !isHost);
  seg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === lobby!.rounds));
  const start = $<HTMLButtonElement>('btn-lobby-start');
  start.hidden = !isHost || lobby.inGame;
  start.disabled = filled < 2;
  let status: string;
  if (lobby.inGame) status = mySlot < 0 ? 'Game in progress — joining as a spectator…' : 'Game in progress…';
  else if (mySlot < 0) status = 'This room is full. You can watch once the game starts.';
  else if (isHost) status = filled < 2 ? 'Share the code, or add CPU players, then start.' : 'Ready when you are, my liege!';
  else status = 'Waiting for the host to sound the horn…';
  $('lobby-status').textContent = status;
}

function shareLink(): string {
  return `${location.origin}/?room=${lobby?.code ?? ''}`;
}

// ------------------------------------------------------------------------ HUD

let chipKey = '';
function buildChips() {
  const wrap = $('scores');
  const s = session?.state;
  if (!s || demo) {
    wrap.innerHTML = '';
    chipKey = '';
    return;
  }
  const key = s.players.map((p) => `${p.name}/${p.look.title}/${p.look.hat}`).join('|');
  if (key === chipKey) return;
  chipKey = key;
  wrap.innerHTML = '';
  wrap.className = `n${s.players.length}`;
  for (const p of s.players) {
    // Each commander's portrait (in their victory hat), name and title, then the score.
    const c = document.createElement('div');
    c.className = 'chip';
    c.innerHTML = `<img class="av" alt=""><span class="who"><span class="nm"></span><span class="ttl"></span></span><span class="sc">0</span><span class="off"></span>`;
    (c.querySelector('.av') as HTMLElement).style.borderColor = PLAYER_COLORS[p.id];
    (c.querySelector('.nm') as HTMLElement).textContent = p.name;
    const ttl = c.querySelector('.ttl') as HTMLElement;
    ttl.textContent = p.look.title;
    ttl.hidden = !p.look.title;
    wrap.append(c);
  }
}

/** Portrait image of a player, framed in their colour. */
function avatarHtml(p: Player, mood: Mood = p.alive ? 'calm' : 'dazed'): string {
  return `<img class="av sm" alt="" src="${portraitUrl(PLAYER_COLORS[p.id], p.look.hat, mood)}" style="border-color:${PLAYER_COLORS[p.id]}">`;
}

function updateChips(s: GameState, you: number) {
  buildChips();
  const chips = $('scores').children;
  // In a battle the sole leader chortles in their portrait; fallen commanders see stars.
  const alive = s.players.filter((p) => p.alive);
  const top = Math.max(0, ...alive.map((p) => p.score));
  const soleLeader = !s.solo && top > 0 && alive.filter((p) => p.score === top).length === 1;
  s.players.forEach((p, i) => {
    const c = chips[i] as HTMLElement | undefined;
    if (!c) return;
    c.classList.toggle('me', i === you);
    c.classList.toggle('out', !p.alive);
    const lead = soleLeader && p.alive && p.score === top;
    c.classList.toggle('lead', lead);
    const mood: Mood = !p.alive ? 'dazed' : lead ? 'laugh' : 'calm';
    const av = c.querySelector('.av') as HTMLImageElement;
    if (av.dataset.mood !== mood) {
      av.dataset.mood = mood;
      av.src = portraitUrl(PLAYER_COLORS[p.id], p.look.hat, mood);
    }
    (c.querySelector('.sc') as HTMLElement).textContent = String(p.score);
    (c.querySelector('.off') as HTMLElement).textContent = session?.online && !p.connected ? '⚡' : '';
  });
}

let lastPhaseKey = '';
let firingShown = false;
let ceaseShown = false;
let lastTickSec = -1;
let hudT = 0;

function banner(text: string, sub = '') {
  const b = $('banner');
  b.classList.remove('show');
  b.innerHTML = '';
  b.append(document.createTextNode(text));
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    b.append(s);
  }
  void b.offsetWidth;
  b.classList.add('show');
}

const isTouch = () => matchMedia('(pointer: coarse)').matches;

function updateHud(sess: Session, dt: number) {
  const s = sess.state;
  const me = sess.you >= 0 ? s.players[sess.you] : null;
  const now = sess.now();

  // Phase banners.
  const key = `${s.phase}:${s.round}`;
  if (key !== lastPhaseKey) {
    lastPhaseKey = key;
    firingShown = false;
    ceaseShown = false;
    phaseBanner(s, me?.alive ? me.cannonsToPlace : 0);
  }
  if (s.phase === 'combat') {
    if (!firingShown && now >= s.fireStart && now < s.fireEnd) {
      firingShown = true;
      banner('FIRE!');
      sfx.fanfare('phase');
    }
    if (!ceaseShown && now >= s.fireEnd) {
      ceaseShown = true;
      banner('CEASE FIRE!');
    }
  }

  // Countdown ticks in the final seconds of timed phases.
  const end = s.phase === 'combat' ? (now < s.fireStart ? s.fireStart : s.fireEnd) : s.phaseEnd;
  const left = Math.max(0, end - now);
  const sec = Math.ceil(left);
  if ((s.phase === 'build' || s.phase === 'cannons' || s.phase === 'select') && sec <= 3 && sec > 0 && sec !== lastTickSec && me?.alive) sfx.tick();
  lastTickSec = sec;

  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.1;

  updateChips(s, sess.you);
  const names: Record<string, string> = {
    select: 'CHOOSE',
    autobuild: 'BUILDING',
    cannons: 'CANNONS',
    build: 'REPAIR',
    summary: 'SCORE',
    gameover: 'GAME OVER',
  };
  let pname = names[s.phase] ?? '';
  if (s.phase === 'combat') pname = now < s.fireStart ? 'READY' : now < s.fireEnd ? 'FIRE!' : 'CEASE';
  $('phase-name').textContent = pname;
  const timer = $('phase-timer');
  const showTimer = s.phase !== 'gameover' && s.phase !== 'summary' && s.phase !== 'autobuild' && !(s.phase === 'combat' && now >= s.fireEnd);
  timer.textContent = showTimer ? String(sec) : '';
  timer.classList.toggle('low', showTimer && sec <= 5);
  $('round').textContent = s.solo
    ? `Level ${s.solo.level}${s.solo.endless ? '' : `/${SOLO_LEVELS}`} · Wave ${Math.max(1, s.solo.wave)}/${s.solo.waves} · ⚓ ${s.solo.sunk}/${s.solo.total}`
    : `Round ${Math.min(s.round, s.maxRounds)}/${s.maxRounds}`;

  const building = s.phase === 'build' && !!me?.alive;
  $('btn-rotate').hidden = !building;
  $('next-wrap').hidden = !building;
  if (building) drawPiecePreview($<HTMLCanvasElement>('next-piece'), renderer.sprites, me!.next, 0, sess.you, me!.faction);
  const cc = $('cannon-count');
  const toPlace = me && s.phase === 'cannons' ? me.cannonsToPlace - ctrl.pendingCannons.length : 0;
  cc.textContent = toPlace > 0 ? `💣 × ${toPlace}` : '';
  const fills = building ? me!.fills - ctrl.pendingFills.length : 0;
  let craters = 0;
  if (building && fills > 0) for (let i = 0; i < s.W * s.H; i++) if (s.crater[i] && s.region[i] === sess.you && s.wall[i] < 0) craters++;
  $('fill-count').textContent = building ? `⛏️ × ${fills}` : '';
  $('fill-count').classList.toggle('dim', fills <= 0 || craters === 0);
  $('btn-zoom').hidden = !renderer.canZoom(s) || s.phase === 'gameover';

  // Contextual hint.
  let hint = '';
  if (me && !me.alive && s.phase !== 'gameover') hint = 'You have been defeated — watching the battle';
  else if (building && fills > 0 && craters > 0 && fillHints < 4)
    hint = `${isTouch() ? 'Tap' : 'Click'} a glowing crater to fill it in · ⛏️ ${fills} left this round`;
  else if (me && s.round <= 2) {
    if (s.phase === 'select') hint = 'Tap a glowing castle to make it your home';
    else if (s.phase === 'cannons' && toPlace > 0)
      hint = isTouch() ? (ctrl.touchMode === 'drag' ? 'Drag to move · tap the cannon to place it' : 'Touch where the cannon goes, lift to place') : 'Click inside your walls to place cannons';
    else if (s.phase === 'build')
      hint = isTouch()
        ? ctrl.touchMode === 'drag'
          ? 'Drag to move · tap piece to drop · ⟳ rotates'
          : 'Touch to aim the piece, lift to drop · ⟳ rotates'
        : 'Click to place · right-click / R rotates';
    else if (s.phase === 'combat' && now >= s.fireStart && now < s.fireEnd)
      hint = s.solo ? 'Tap ahead of the ships — cannonballs are slow!' : 'Tap enemy walls to blast holes — make every shot count';
  }
  $('hint').textContent = hint;

  // Round summary.
  const sum = $('summary');
  if (s.phase === 'summary' && s.summary.length) {
    if (sum.hidden) {
      sum.hidden = false;
      const rows = s.summary
        .map((r) => {
          const p = s.players[r.p];
          const who = p ? `${avatarHtml(p)} ${escapeHtml(p.name)}` : '';
          return `<tr><td>${who}</td><td>${r.castles}</td><td>${r.territory}</td><td>${r.bonus}</td><td>${r.clean}</td><td class="tot">+${r.total}</td></tr>`;
        })
        .join('');
      sum.innerHTML =
        `<table><tr><th>Round ${s.round}</th><th>Castles</th><th>Land</th><th>Bonus</th><th>Clean</th><th>Total</th></tr>${rows}</table>` +
        `<p class="lore"><b>📜 Castle lore</b> ${escapeHtml(nextFact())}</p>`;
    }
  } else sum.hidden = true;

  if (s.phase === 'gameover') showGameOver(sess);
}

function phaseBanner(s: GameState, cannons: number) {
  switch (s.phase) {
    case 'select':
      banner(s.solo ? 'DEFEND YOUR LAND' : 'CHOOSE YOUR CASTLE', s.solo ? 'Choose a home castle' : 'Tap a castle in your territory');
      sfx.fanfare('phase');
      break;
    case 'cannons':
      banner('PLACE CANNONS', cannons > 0 ? `${cannons} cannon${cannons > 1 ? 's' : ''} to place` : '');
      sfx.fanfare('phase');
      break;
    case 'combat':
      if (s.solo) banner(`LEVEL ${s.solo.level}`, s.ships.length ? 'The fleet regroups…' : 'Enemy fleet approaching');
      else banner('PREPARE FOR BATTLE', readyCall(s.round));
      break;
    case 'build':
      banner('BUILD & REPAIR', buildCall(s.round));
      sfx.fanfare('phase');
      fillHints++;
      break;
    default:
      break;
  }
}

function escapeHtml(t: string) {
  return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let goShown = false;
let execShown: string | null = null;
let fillHints = 0;

const ELIMINATION_QUIPS = [
  'Their walls were more of a suggestion',
  'Pack your things, the moat is full',
  'Should have built a bigger wall',
  'The peasants are already rioting',
  'Their castle is now a fixer-upper',
  'Game over, man. Game over.',
  'The ravens have left the tower',
  'Even the rats have fled',
  'The court jester saw this coming',
  'Their moat was more of a puddle',
  'Their banner now makes a fine tablecloth',
];

/** Saves a campaign / endless record; returns true when it beats the previous best. */
function recordBest(s: GameState): boolean {
  if (!s.solo || localConfig?.mode !== 'solo') return false;
  const mode = s.solo.endless ? 'endless' : 'campaign';
  const cur: Best = { score: s.players[0]?.score ?? 0, level: s.solo.level, wave: s.solo.wave, won: s.solo.victory };
  const old = loadBest(mode, s.solo.difficulty);
  if (old && old.score >= cur.score) return false;
  store.set(bestKey(mode, s.solo.difficulty), JSON.stringify(cur));
  return true;
}

function playBeat(beat: Beat) {
  switch (beat) {
    case 'splash':
      sfx.splash();
      break;
    case 'splat':
      sfx.splat();
      break;
    case 'whoosh':
      sfx.whoosh();
      break;
    case 'ding':
      sfx.ding();
      break;
    case 'roar':
      sfx.roar();
      break;
    case 'burp':
      sfx.burp();
      break;
    case 'jingle':
      sfx.jingle();
      break;
    case 'honk':
      sfx.honk();
      break;
    default:
      sfx.boom();
  }
  buzz(beat === 'chop' || beat === 'splat' ? 30 : 15);
}

function showGameOver(sess: Session) {
  const s = sess.state;
  const panel = $('gameover');
  if (!goShown) {
    goShown = true;
    panel.hidden = false;
    let title: string;
    if (s.solo) title = s.solo.victory ? 'THE FLEET IS DEFEATED!' : s.solo.endless ? 'THE SIEGE IS OVER' : 'YOUR KINGDOM HAS FALLEN';
    else if (s.winner === sess.you) title = 'VICTORY!';
    else title = `${s.players[s.winner]?.name ?? 'Nobody'} WINS`;
    $('go-title').textContent = title;
    let sub = '';
    if (s.solo) {
      const diff = s.solo.difficulty[0].toUpperCase() + s.solo.difficulty.slice(1);
      sub = s.solo.victory
        ? `${diff} campaign complete!`
        : `${diff}${s.solo.endless ? ' endless siege' : ''}: fell on level ${s.solo.level}, wave ${Math.max(1, s.solo.wave)}.`;
      if (recordBest(s)) sub += ' 🏆 New personal best!';
    }
    $('go-sub').textContent = sub;
    const rivals = s.players.filter((p) => p.id !== sess.you).length;
    $('go-choose-text').textContent = s.solo
      ? 'The Pirate Admiral is at your mercy. Choose their fate:'
      : `Your rival${rivals > 1 ? 's are' : ' is'} at your mercy. Choose their fate:`;
    const fates = $('go-fates');
    fates.innerHTML = '';
    for (const m of EXECUTIONS) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `${FATES[m].icon} ${FATES[m].label}`;
      b.onclick = () => session?.act({ type: 'execute', method: m });
      fates.append(b);
    }
    renderReport(s, sess.you);
    const hon = $('go-honours');
    hon.hidden = sess.you < 0 || account.signedIn;
    hon.innerHTML = '<p class="small">Sign in from the main menu to keep your stats and earn honours.</p>';
    const online = sess.online;
    const isHost = lobby ? lobby.host === mySlot : true;
    $('btn-again').textContent = online ? (isHost ? 'Back to lobby' : 'Lobby') : 'Play again';
    if (s.solo) sfx.fanfare(s.solo.victory ? 'win' : 'bad');
    else sfx.fanfare(s.winner === sess.you ? 'win' : 'bad');
  }
  const canChoose = s.winner === sess.you && sess.you >= 0 && !s.execution;
  $('go-choose').hidden = !canChoose;
  const wait = $('go-wait');
  wait.hidden = canChoose || !!s.execution;
  if (!wait.hidden) {
    const w = s.players[s.winner];
    wait.textContent = s.solo ? 'The pirates are deciding your fate…' : `${w?.name ?? 'The victor'} is deciding the losers' fate…`;
  }
  // A local game is saved once the losers' fate is sealed (the room saves online games).
  if (s.execution) recordLocalGame();
  if (s.execution && execShown !== s.execution) {
    execShown = s.execution;
    const c = $<HTMLCanvasElement>('exec-canvas');
    $('exec-wrap').hidden = false;
    $('exec-lore').innerHTML = `<b>📜 From the chronicles</b> ${escapeHtml(FATE_FACTS[s.execution])}`;
    $('gameover').classList.add('with-exec');
    execScene?.stop();
    let victims = s.players.filter((p) => p.id !== s.winner).map((p) => figureFor(p.name, p.id, p.look));
    const w = s.players[s.winner];
    let executioner = figureFor(w?.name ?? '', s.winner, w?.look);
    if (s.solo) {
      const me = figureFor(s.players[0]?.name ?? 'You', 0, s.players[0]?.look);
      victims = s.solo.victory ? [PIRATE_ADMIRAL] : [me];
      executioner = s.solo.victory ? me : PIRATE_ADMIRAL;
    }
    execScene = new ExecutionScene(c, s.execution, victims, executioner, playBeat);
  }
}

// ---------------------------------------------------------- end-of-game report

interface ReportRow {
  label: string;
  value: (p: Player) => number | null;
  fmt?: (v: number) => string;
  /** Lower is better (for highlighting the best value). */
  low?: boolean;
  only?: 'battle' | 'solo';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const REPORT: ReportRow[] = [
  { label: 'Score', value: (p) => p.score, fmt: (v) => v.toLocaleString() },
  { label: 'Castles held', value: (p) => p.castles },
  { label: 'Ships sunk', value: (p) => p.stats.ships, only: 'solo' },
  { label: 'Walls destroyed', value: (p) => p.stats.walls, only: 'battle' },
  { label: 'Walls lost', value: (p) => p.stats.wallsLost, low: true },
  { label: 'Cannons placed', value: (p) => p.stats.cannons },
  { label: 'Cannonballs fired', value: (p) => p.stats.shots },
  { label: 'Walls hit per shot', value: (p) => ratio(p.stats.walls, p.stats.shots), fmt: (v) => v.toFixed(2), only: 'battle' },
  { label: 'Hit rate', value: (p) => ratio(p.stats.hits, p.stats.shots), fmt: pct, only: 'solo' },
  { label: 'Cannons wrecked', value: (p) => p.stats.cannonsKilled, only: 'battle' },
  { label: 'Castle area (largest)', value: (p) => p.stats.maxLand, fmt: (v) => `${v} tiles` },
  { label: 'Troops squashed', value: (p) => p.stats.grunts, only: 'solo' },
  { label: 'Craters filled', value: (p) => p.stats.craters },
];

/** Everyone's stats side by side, best value in each row picked out. */
function renderReport(s: GameState, you: number) {
  const ranked = [...s.players].sort((a, b) => b.score - a.score);
  const many = ranked.length > 1;
  const head = ranked
    .map((p) => {
      const mark = `${p.id === s.winner && !s.solo ? ' 👑' : ''}${p.alive ? '' : ' ☠'}`;
      const title = p.look.title ? `<span class="pt ttl">${escapeHtml(p.look.title)}</span>` : '';
      return `<th class="${p.id === you ? 'me' : ''}">${avatarHtml(p)}<span class="pn">${escapeHtml(p.name)}</span>${mark}${title}</th>`;
    })
    .join('');
  const rows = REPORT.filter((r) => !r.only || r.only === (s.solo ? 'solo' : 'battle'))
    .map((r) => {
      const vals = ranked.map((p) => r.value(p));
      const nums = vals.filter((v): v is number => v !== null);
      const best = nums.length ? (r.low ? Math.min(...nums) : Math.max(...nums)) : null;
      const spread = nums.length > 1 && Math.min(...nums) !== Math.max(...nums);
      const cells = vals
        .map((v, i) => {
          const cls = [ranked[i].id === you ? 'me' : '', many && spread && v === best ? 'best' : ''].filter(Boolean).join(' ');
          return `<td class="${cls}">${v === null ? '–' : (r.fmt ?? String)(v)}</td>`;
        })
        .join('');
      return `<tr><td>${r.label}</td>${cells}</tr>`;
    })
    .join('');
  $('go-report').innerHTML = `<table class="report"><tr><th>${s.solo ? 'Your report' : 'Battle report'}</th>${head}</tr>${rows}</table>`;
}

function rewardText(r: Reward): string {
  if (r.title) return `title “${r.title}”`;
  if (r.hat) return `victory hat: ${HAT_NAMES[r.hat]}`;
  if (r.trail) return `cannonball trail: ${TRAIL_NAMES[r.trail]}`;
  return '';
}

/** Lists honours just earned (on the end screen, or as a toast if it has closed). */
function showHonours(ids: string[]) {
  const list = ids.map(achievement).filter((a) => !!a);
  if (!list.length) return;
  sfx.fanfare('good');
  if (!goShown) {
    toast(`🏅 New honour${list.length > 1 ? 's' : ''}: ${list.map((a) => a!.name).join(', ')}`, 5000);
    return;
  }
  const el = $('go-honours');
  el.hidden = false;
  el.innerHTML =
    `<p class="hon-title">🏅 New honour${list.length > 1 ? 's' : ''}!</p>` +
    list
      .map(
        (a) =>
          `<div class="honour"><span class="ic">${a!.icon}</span><span><b>${escapeHtml(a!.name)}</b><small>Unlocked ${escapeHtml(rewardText(a!.reward))}</small></span></div>`,
      )
      .join('');
}

/** Saves a finished campaign or computer battle to the signed-in commander's record. */
function recordLocalGame() {
  const sess = session;
  if (recorded || demo || !sess || sess.online || !localConfig || sess.you < 0 || sess.state.phase !== 'gameover') return;
  recorded = true;
  if (!account.signedIn) return;
  const s = sess.state;
  const kind: GameKind = s.solo ? (s.solo.endless ? 'endless' : 'campaign') : 'battle';
  const rec = recordFor(s, sess.you, kind, localGameId);
  const el = $('go-honours');
  const onScreen = session === sess && goShown;
  if (onScreen) {
    el.hidden = false;
    el.innerHTML = '<p class="small">Saving to your record…</p>';
  }
  void account.submit(rec).then((ids) => {
    const still = session === sess && goShown;
    if (ids?.length) showHonours(ids);
    else if (still) {
      el.innerHTML = ids ? '<p class="small">✓ Saved to your record.</p>' : '<p class="small">Offline: this game will be saved when you are back online.</p>';
    }
  });
}

function hideGameOver() {
  goShown = false;
  execShown = null;
  execScene?.stop();
  execScene = null;
  $('gameover').hidden = true;
  $('gameover').classList.remove('with-exec');
  $('exec-wrap').hidden = true;
  $('summary').hidden = true;
}

// --------------------------------------------------------------------- events

function onEvent(e: GameEvent, sess: Session) {
  const s = sess.state;
  if (!demo) renderer.fx.handle(e, s, sess.you);
  const quiet = demo;
  switch (e.e) {
    case 'fire':
      if (!quiet) sfx.cannon();
      if (e.p === sess.you) buzz(8);
      break;
    case 'boom':
      if (quiet) break;
      if (e.kind === 'water') sfx.splash();
      else sfx.boom(e.kind === 'cannon' || e.kind === 'ship');
      break;
    case 'sink':
      if (!quiet) sfx.boom(true);
      break;
    case 'castle':
      if (e.p === sess.you && !quiet) sfx.castle();
      break;
    case 'eliminated':
      if (quiet) break;
      banner(`${s.players[e.p]?.name ?? 'A player'} HAS FALLEN`, ELIMINATION_QUIPS[(e.p + s.round) % ELIMINATION_QUIPS.length]);
      sfx.fanfare(e.p === sess.you ? 'bad' : 'good');
      break;
    case 'levelComplete':
      if (quiet) break;
      banner('FLEET DESTROYED!', `Level ${e.level} bonus +${e.bonus}`);
      sfx.fanfare('good');
      break;
    case 'wave': {
      if (quiet) break;
      sfx.horn();
      const solo = s.solo;
      if (e.wave > 1 && solo && sess.now() - s.phaseStart > 1.5) {
        const last = e.wave === e.waves;
        const boss = last && levelDef(e.level, solo.difficulty).boss;
        banner(`WAVE ${e.wave}/${e.waves}`, boss ? 'The pirate flagship approaches!' : last ? 'Final wave!' : 'More sails on the horizon!');
      }
      break;
    }
    default:
      break;
  }
}

// ----------------------------------------------------------------- main loop

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
  last = t;
  const sess = session;
  if (sess) {
    const events = sess.update(dt);
    for (const e of events) onEvent(e, sess);
    if (sess.online) {
      const now = sess.now();
      sess.state.balls = sess.state.balls.filter((b) => now < b.t0 + b.dur + 0.1);
    }
    if (demo && sess.state.phase === 'gameover' && sess.state.time > sess.state.phaseStart + 4) startDemo();
    ctrl.update(dt);
    renderer.top = demo ? 0 : $('topbar').offsetHeight;
    renderer.frame(sess, ctrl, dt);
    if (!demo) updateHud(sess, dt);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ accounts

let acctMode: 'login' | 'signup' = 'login';
let profTab = 'record';

function updateAccountUI() {
  const p = account.profile;
  $('acct-guest').hidden = !!p;
  $('acct-card').hidden = !p;
  if (p) {
    $('acct-name-show').textContent = styledName(p.name, account.look);
    const wins = p.career.wins;
    $('acct-sum').textContent = `${wins} win${wins === 1 ? '' : 's'} · ${Object.keys(p.career.honours).length}/${ACHIEVEMENTS.length} honours`;
    drawFigurePreview($<HTMLCanvasElement>('acct-figure'), PLAYER_COLORS[0], account.look.hat);
  }
  if (!$('screen-profile').hidden) {
    if (p) renderProfile();
    else {
      screenStack = [];
      show('screen-home');
    }
  }
}

function setAcctMode(m: 'login' | 'signup') {
  acctMode = m;
  document.querySelectorAll<HTMLElement>('.seg[data-seg="acct-mode"] button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
  $('acct-submit').textContent = m === 'login' ? 'Sign in' : 'Create account';
  $<HTMLInputElement>('acct-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('acct-msg').textContent = m === 'signup' ? 'Choose a name (3-16 letters) and a password of 6 or more characters.' : '';
}

async function submitAccount(e: Event) {
  e.preventDefault();
  const name = $<HTMLInputElement>('acct-user').value.trim();
  const pass = $<HTMLInputElement>('acct-pass').value;
  const btn = $<HTMLButtonElement>('acct-submit');
  btn.disabled = true;
  $('acct-msg').textContent = acctMode === 'login' ? 'Opening the gates…' : 'Carving your name in stone…';
  const err = await account.enter(acctMode, name, pass);
  btn.disabled = false;
  if (err) {
    $('acct-msg').textContent = err;
    return;
  }
  $<HTMLInputElement>('acct-pass').value = '';
  $('acct-msg').textContent = '';
  toast(`Welcome, ${account.profile!.name}!`);
  back();
}

const KIND_LABEL: Record<GameKind, string> = { campaign: '⚓ Campaign', endless: '🌊 Endless siege', battle: '⚔️ vs Computer', online: '🌐 Online' };

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 14 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString();
}

function renderProfile() {
  const p = account.profile;
  if (!p) return;
  $('prof-name').textContent = styledName(p.name, account.look);
  const since = new Date(p.since).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const waiting = account.pending;
  $('prof-sub').textContent = `Commander since ${since}${waiting ? ` · ${waiting} game${waiting > 1 ? 's' : ''} waiting to be saved` : ''}`;
  drawFigurePreview($<HTMLCanvasElement>('prof-figure'), PLAYER_COLORS[0], account.look.hat);
  document.querySelectorAll<HTMLElement>('.seg[data-seg="prof-tab"] button').forEach((b) => b.classList.toggle('on', b.dataset.v === profTab));
  const body = $('prof-body');
  if (profTab === 'honours') body.innerHTML = honoursHtml();
  else if (profTab === 'armoury') renderArmoury(body);
  else if (profTab === 'hall') void renderHall(body);
  else body.innerHTML = recordHtml();
}

function recordHtml(): string {
  const c = account.profile!.career;
  const t = c.totals;
  const tiles: [string, string][] = [
    ['Games', String(c.games)],
    ['Wins', String(c.wins)],
    ['Win rate', c.games ? pct(c.wins / c.games) : '–'],
    ['Honours', `${Object.keys(c.honours).length}/${ACHIEVEMENTS.length}`],
  ];
  const modes = (Object.keys(KIND_LABEL) as GameKind[])
    .map((k) => {
      const m = c.modes[k];
      const lvl = (k === 'campaign' || k === 'endless') && m.level ? ` <span class="small">(lvl ${m.level})</span>` : '';
      return `<tr><td>${KIND_LABEL[k]}</td><td>${m.played}</td><td>${m.won}</td><td>${m.best ? m.best.toLocaleString() : '–'}${lvl}</td></tr>`;
    })
    .join('');
  const shotRatio = (n: number, f: (v: number) => string) => (t.shots ? f(n / t.shots) : '–');
  const dealt = EXECUTIONS.reduce((a, m) => a + (c.dealt[m] ?? 0), 0);
  const fav = EXECUTIONS.reduce((a, m) => ((c.dealt[m] ?? 0) > (c.dealt[a] ?? 0) ? m : a), EXECUTIONS[0]);
  const totals: [string, string | number][] = [
    ['Walls destroyed', t.walls],
    ['Walls lost', t.wallsLost],
    ['Cannons placed', t.cannons],
    ['Cannonballs fired', t.shots],
    ['Walls hit per shot', shotRatio(t.walls, (v) => v.toFixed(2))],
    ['Hit rate', shotRatio(t.hits, pct)],
    ['Cannons wrecked', t.cannonsKilled],
    ['Cannons lost', t.cannonsLost],
    ['Ships sunk', t.ships],
    ['Flagships sunk', t.flagships],
    ['Troops squashed', t.grunts],
    ['Wall pieces laid', t.pieces],
    ['Craters filled', t.craters],
    ['Castles claimed', t.castles],
    ['Largest castle area', `${t.maxLand} tiles`],
    ['Most castles held', t.maxCastles],
    ['Rounds survived', t.rounds],
    ['Punishments dealt', dealt ? `${dealt} (mostly ${FATES[fav].icon} ${FATES[fav].label.toLowerCase()})` : 0],
    ['Punishments suffered', c.suffered],
  ];
  const recent = account.profile!.recent;
  const recentHtml = recent.length
    ? recent
        .map((g) => {
          const diff = g.kind === 'online' ? '' : ` · ${g.difficulty}`;
          const res = g.won ? '<b class="won">Won</b>' : g.kind === 'endless' ? `level ${g.level}` : g.players > 1 ? `${ordinal(g.rank)} of ${g.players}` : 'Lost';
          return `<li><span>${KIND_LABEL[g.kind]}${diff}</span><span>${res} · ${g.score.toLocaleString()}</span><span class="small">${ago(g.at)}</span></li>`;
        })
        .join('')
    : '<li class="small">No games yet. Go and knock some walls down!</li>';
  return (
    `<div class="tiles">${tiles.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>` +
    `<table class="modes"><tr><th>Mode</th><th>Played</th><th>Won</th><th>Best score</th></tr>${modes}</table>` +
    `<h3>Career totals</h3><dl class="totals">${totals.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` +
    `<h3>Recent games</h3><ul class="recent">${recentHtml}</ul>`
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function honoursHtml(): string {
  const h = account.profile!.career.honours;
  return `<div class="honours">${ACHIEVEMENTS.map((a) => {
    const at = h[a.id];
    const note = at ? `Earned ${new Date(at).toLocaleDateString()} · unlocked ${rewardText(a.reward)}` : `Unlocks ${rewardText(a.reward)}`;
    return `<div class="honour ${at ? 'got' : 'locked'}"><span class="ic">${at ? a.icon : '🔒'}</span><span><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.desc)}</small><small class="rw">${escapeHtml(note)}</small></span></div>`;
  }).join('')}</div>`;
}

const TRAIL_ICONS: Record<string, string> = { none: '●', smoke: '💨', fire: '🔥', gold: '✨', arcane: '🔮' };

function renderArmoury(body: HTMLElement) {
  const h = account.profile!.career.honours;
  const look = account.look;
  const item = (kind: keyof Look, value: string, label: string, extra = '') => {
    const ok = isUnlocked(kind, value, h);
    const by = unlockedBy(kind, value);
    const lock = ok ? '' : `<small>🔒 ${escapeHtml(by?.name ?? '')}</small>`;
    return `<button type="button" class="arm${look[kind] === value ? ' on' : ''}" data-kind="${kind}" data-v="${escapeHtml(value)}"${ok ? '' : ' disabled'}>${extra}<span>${escapeHtml(label)}</span>${lock}</button>`;
  };
  body.innerHTML =
    `<h3>Title</h3><div class="arms">${item('title', '', 'No title')}${TITLES.map((t) => item('title', t, t)).join('')}</div>` +
    `<h3>Victory hat</h3><div class="arms hats">${HATS.map((x) => item('hat', x, HAT_NAMES[x], '<canvas></canvas>')).join('')}</div>` +
    `<h3>Cannonball trail</h3><div class="arms">${TRAILS.map((x) => item('trail', x, TRAIL_NAMES[x], `<i>${TRAIL_ICONS[x]}</i>`)).join('')}</div>` +
    '<p class="small">Your title follows your name, your hat is worn in the finale, and your trail follows every cannonball you fire. Online, everyone sees them.</p>';
  body.querySelectorAll<HTMLElement>('.hats .arm').forEach((b) => drawFigurePreview(b.querySelector('canvas')!, PLAYER_COLORS[0], b.dataset.v as Look['hat']));
}

async function renderHall(body: HTMLElement) {
  body.innerHTML = '<p class="small">Summoning the heralds…</p>';
  const rows = await account.hall();
  if (profTab !== 'hall' || $('screen-profile').hidden) return;
  if (!rows) {
    body.innerHTML = '<p class="small">The heralds cannot be reached. Are you online?</p>';
    return;
  }
  const me = account.profile?.name;
  body.innerHTML =
    `<table class="hall"><tr><th>#</th><th>Commander</th><th>Wins</th><th>Games</th><th>Honours</th><th>Best</th></tr>` +
    rows
      .map(
        (r, i) =>
          `<tr class="${r.name === me ? 'me' : ''}"><td>${i + 1}</td><td>${escapeHtml(r.name)}${r.title ? ` <span class="ttl">${escapeHtml(r.title)}</span>` : ''}</td><td>${r.wins}</td><td>${r.games}</td><td>${r.honours}</td><td>${r.best.toLocaleString()}</td></tr>`,
      )
      .join('') +
    '</table>';
}

// --------------------------------------------------------------------- wiring

function wire() {
  $<HTMLInputElement>('in-name').value = settings.name;
  $<HTMLInputElement>('in-name').addEventListener('change', () => playerName());

  document.addEventListener('click', (e) => {
    sfx.unlock();
    const lore = (e.target as HTMLElement).closest('.lore')?.querySelector<HTMLElement>('[data-lore]');
    if (lore) lore.textContent = nextFact();
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (!el) return;
    const go = el.dataset.go!;
    if (go === 'back') back();
    else if (go === 'campaign') startCampaign();
    else {
      if (go === 'screen-campaign') updateCampaignScreen();
      if (go === 'screen-account') setAcctMode(acctMode);
      show(go);
      if (go === 'screen-profile') {
        renderProfile();
        void account.refresh();
      }
    }
  });

  document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    const name = seg.dataset.seg!;
    const current =
      name === 'sound' ? settings.sound : name === 'touch' ? settings.touch : name === 'camp-diff' ? settings.campDiff : name === 'camp-mode' ? settings.campMode : null;
    if (current) seg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === current));
    seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b || seg.classList.contains('locked')) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const v = b.dataset.v!;
      if (name === 'sound') {
        settings.sound = v;
        store.set('sound', v);
        sfx.muted = v === 'off';
      } else if (name === 'touch') {
        settings.touch = v as TouchMode;
        store.set('touch', v);
        ctrl.touchMode = v as TouchMode;
      } else if (name === 'lobby-rounds') {
        net?.send({ t: 'rounds', rounds: Number(v) });
      } else if (name === 'camp-diff') {
        settings.campDiff = v as Difficulty;
        store.set('campDiff', v);
        updateCampaignScreen();
      } else if (name === 'camp-mode') {
        settings.campMode = v === 'endless' ? 'endless' : 'campaign';
        store.set('campMode', v);
        updateCampaignScreen();
      } else if (name === 'acct-mode') {
        setAcctMode(v === 'signup' ? 'signup' : 'login');
      } else if (name === 'prof-tab') {
        profTab = v;
        renderProfile();
      }
    });
  });

  $('acct-form').addEventListener('submit', (e) => void submitAccount(e));
  $('btn-signout').onclick = async () => {
    await account.logout();
    toast('Signed out. Farewell!');
  };
  $('prof-body').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.arm');
    if (!b || b.disabled || b.classList.contains('on')) return;
    const kind = b.dataset.kind as keyof Look;
    b.classList.add('busy');
    void account.wear({ ...account.look, [kind]: b.dataset.v ?? '' }).then((ok) => {
      if (!ok) toast('Could not reach the armoury. Are you online?');
      renderProfile();
    });
  });

  $('btn-battle-start').onclick = startBattle;
  $('btn-create').onclick = () => joinRoom(randomCode());
  $('btn-join').onclick = () => joinRoom($<HTMLInputElement>('in-code').value);
  $<HTMLInputElement>('in-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom($<HTMLInputElement>('in-code').value);
  });
  $('btn-lobby-start').onclick = () => net?.send({ t: 'start' });
  $('btn-leave').onclick = leaveGame;
  $('btn-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareLink());
      toast('Invite link copied');
    } catch {
      toast(shareLink(), 5000);
    }
  };
  $('btn-share').onclick = async () => {
    const url = shareLink();
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'Rampart', text: `Join my Rampart battle! Room ${lobby?.code}`, url });
        return;
      } catch {
        /* cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied');
    } catch {
      toast(url, 5000);
    }
  };

  $('btn-rotate').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctrl.rotate();
    buzz(8);
  });
  $('btn-zoom').onclick = () => {
    const s = session?.state;
    if (!s) return;
    if (s.phase === 'combat') renderer.zoomCombat = !renderer.zoomCombat;
    else renderer.zoomBuild = !(renderer.zoomBuild ?? renderer.canZoom(s));
  };
  $('btn-menu').onclick = () => {
    if (session && !session.online) session.paused = true;
    $('btn-resume').textContent = session?.online ? 'Back to game' : 'Resume';
    show('screen-pause');
  };
  $('btn-resume').onclick = () => {
    if (session) session.paused = false;
    show(null);
  };
  $('btn-pause-quit').onclick = leaveGame;
  $('btn-quit').onclick = leaveGame;
  $('btn-again').onclick = () => {
    if (session?.online) {
      if (lobby && lobby.host === mySlot) net?.send({ t: 'lobby' });
      $('hud').hidden = true;
      document.body.classList.remove('ingame');
      hideGameOver();
      startDemo();
      show('screen-lobby');
      renderLobby();
    } else if (localConfig) {
      startLocal(localConfig);
    }
  };

  window.addEventListener('resize', () => renderer.resize());
  window.visualViewport?.addEventListener('resize', () => renderer.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session && !session.online && !demo && session.state.phase !== 'gameover') {
      session.paused = true;
      $('btn-resume').textContent = 'Resume';
      show('screen-pause');
    }
    if (!document.hidden && !demo) void requestWakeLock();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && session && !demo) {
      if ($('screen-pause').hidden) $('btn-menu').click();
      else $('btn-resume').click();
    }
  });
}

// Small hook for automated browser tests and debugging from the console.
(window as unknown as { __rampart: unknown }).__rampart = {
  get session() {
    return session;
  },
  ctrl,
  renderer,
};

wire();
account.onChange = updateAccountUI;
updateAccountUI();
void account.refresh().then(async () => {
  const ids = await account.flush();
  if (ids.length) showHonours(ids);
});
buildFactionPicker();
startDemo();
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  show('screen-home');
  joinRoom(roomParam);
} else {
  show('screen-home');
}
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
