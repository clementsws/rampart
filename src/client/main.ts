import { AI_NAMES, FACTIONS, PLAYER_COLORS, SOLO_LEVELS, levelDef, validFaction } from '../shared/constants';
import { GameConfig } from '../shared/engine';
import { LobbyInfo, ServerMsg } from '../shared/protocol';
import { Difficulty, EXECUTIONS, GameEvent, GameState } from '../shared/types';
import { buzz, sfx } from './audio';
import { Beat, ExecutionScene, FATES, PIRATE_ADMIRAL, figureFor } from './execution';
import { Controller, TouchMode } from './input';
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

function playerName(): string {
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
  localConfig = cfg;
  setSession(new LocalSession(cfg, 0));
  enterGame();
}

function startCampaign() {
  startLocal({
    mode: 'solo',
    campaign: { difficulty: settings.campDiff, endless: settings.campMode === 'endless' },
    players: [{ name: playerName(), ai: false, difficulty: 'normal', faction: settings.faction }],
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
  const players: GameConfig['players'] = [{ name: playerName(), ai: false, difficulty, faction: settings.faction }];
  for (let i = 1; i <= n; i++) players.push({ name: AI_NAMES[i], ai: true, difficulty });
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
    () => ({ t: 'hello', name: playerName(), token: store.get('token.' + code), faction: settings.faction }),
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
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = s.kind === 'open' ? 'transparent' : PLAYER_COLORS[i];
    dot.style.border = `2px solid ${PLAYER_COLORS[i]}`;
    const name = document.createElement('span');
    name.className = 'name';
    const tags: string[] = [];
    if (s.kind === 'human') {
      name.textContent = s.name;
      if (i === lobby!.host) tags.push('host');
      if (i === mySlot) tags.push('you');
      if (!s.connected) tags.push('offline');
    } else if (s.kind === 'ai') {
      name.textContent = s.name;
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
  else if (isHost) status = filled < 2 ? 'Share the code, or add CPU players, then start.' : 'Ready when you are!';
  else status = 'Waiting for the host to start the game…';
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
  const key = s.players.map((p) => p.name).join('|');
  if (key === chipKey) return;
  chipKey = key;
  wrap.innerHTML = '';
  for (const p of s.players) {
    const c = document.createElement('div');
    c.className = 'chip';
    c.innerHTML = `<span class="dot" style="background:${PLAYER_COLORS[p.id]}"></span><span class="nm"></span><span class="sc">0</span><span class="off"></span>`;
    (c.querySelector('.nm') as HTMLElement).textContent = p.name;
    wrap.append(c);
  }
}

function updateChips(s: GameState, you: number) {
  buildChips();
  const chips = $('scores').children;
  s.players.forEach((p, i) => {
    const c = chips[i] as HTMLElement | undefined;
    if (!c) return;
    c.classList.toggle('me', i === you);
    c.classList.toggle('out', !p.alive);
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
          return `<tr><td><span style="color:${PLAYER_COLORS[r.p]}">■</span> ${escapeHtml(p?.name ?? '')}</td><td>${r.castles}</td><td>${r.territory}</td><td>${r.bonus}</td><td>${r.clean}</td><td class="tot">+${r.total}</td></tr>`;
        })
        .join('');
      sum.innerHTML = `<table><tr><th>Round ${s.round}</th><th>Castles</th><th>Land</th><th>Bonus</th><th>Clean</th><th>Total</th></tr>${rows}</table>`;
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
      else banner('PREPARE FOR BATTLE', 'Ready your cannons…');
      break;
    case 'build':
      banner('BUILD & REPAIR', 'Close your walls!');
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
    const ranked = [...s.players].sort((a, b) => b.score - a.score);
    $('go-standings').innerHTML =
      `<table><tr><th>Commander</th><th>Castles</th><th>Score</th></tr>` +
      ranked
        .map(
          (p) =>
            `<tr><td><span style="color:${PLAYER_COLORS[p.id]}">■</span> ${escapeHtml(p.name)}${p.id === s.winner && !s.solo ? ' 👑' : ''}${p.alive ? '' : ' ☠'}</td><td>${p.castles}</td><td class="tot">${p.score}</td></tr>`,
        )
        .join('') +
      '</table>';
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
  if (s.execution && execShown !== s.execution) {
    execShown = s.execution;
    const c = $<HTMLCanvasElement>('exec-canvas');
    c.hidden = false;
    $('gameover').classList.add('with-exec');
    execScene?.stop();
    let victims = s.players.filter((p) => p.id !== s.winner).map((p) => figureFor(p.name, p.id));
    let executioner = figureFor(s.players[s.winner]?.name ?? '', s.winner);
    if (s.solo) {
      const me = figureFor(s.players[0]?.name ?? 'You', 0);
      victims = s.solo.victory ? [PIRATE_ADMIRAL] : [me];
      executioner = s.solo.victory ? me : PIRATE_ADMIRAL;
    }
    execScene = new ExecutionScene(c, s.execution, victims, executioner, playBeat);
  }
}

function hideGameOver() {
  goShown = false;
  execShown = null;
  execScene?.stop();
  execScene = null;
  $('gameover').hidden = true;
  $('gameover').classList.remove('with-exec');
  $<HTMLCanvasElement>('exec-canvas').hidden = true;
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

// --------------------------------------------------------------------- wiring

function wire() {
  $<HTMLInputElement>('in-name').value = settings.name;
  $<HTMLInputElement>('in-name').addEventListener('change', () => playerName());

  document.addEventListener('click', (e) => {
    sfx.unlock();
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (!el) return;
    const go = el.dataset.go!;
    if (go === 'back') back();
    else if (go === 'campaign') startCampaign();
    else {
      if (go === 'screen-campaign') updateCampaignScreen();
      show(go);
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
      }
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
