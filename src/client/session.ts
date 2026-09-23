import { TICK } from '../shared/constants';
import { Game, GameConfig } from '../shared/engine';
import { StaticMap, TickMsg, applyTick, stateFromStatic } from '../shared/protocol';
import { Action, GameEvent, GameState } from '../shared/types';

export interface Session {
  readonly online: boolean;
  readonly state: GameState;
  readonly you: number;
  paused: boolean;
  /** Game-clock estimate for smooth rendering between simulation ticks. */
  now(): number;
  act(a: Action): boolean;
  /** Advances the simulation (local) and returns events that happened since the last call. */
  update(dt: number): GameEvent[];
}

/** Game simulated in the browser: campaign and battles against the computer. */
export class LocalSession implements Session {
  readonly online = false;
  readonly game: Game;
  paused = false;
  private acc = 0;

  /** you = -1 runs a computer-only game (the attract mode behind the menus). */
  constructor(
    readonly config: GameConfig,
    readonly you = 0,
  ) {
    this.game = new Game(config);
  }

  get state() {
    return this.game.s;
  }

  now() {
    return this.game.s.time + this.acc;
  }

  act(a: Action) {
    return this.you >= 0 && this.game.act(this.you, a);
  }

  update(dt: number): GameEvent[] {
    if (!this.paused) {
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= TICK) {
        this.game.tick(TICK);
        this.acc -= TICK;
      }
    }
    // Only the network encoder consumes these; keep them from growing.
    this.game.dirty.clear();
    this.game.newBalls.length = 0;
    return this.game.drainEvents();
  }
}

/** Mirror of a game simulated by the room's Durable Object. */
export class OnlineSession implements Session {
  readonly online = true;
  readonly state: GameState;
  paused = false;
  private events: GameEvent[] = [];
  private offset = 0;
  private synced = false;

  constructor(
    map: StaticMap,
    full: TickMsg,
    readonly you: number,
    private readonly sendAction: (a: Action) => void,
  ) {
    this.state = stateFromStatic(map);
    this.apply(full);
  }

  apply(m: TickMsg) {
    this.events.push(...applyTick(this.state, m));
    const sample = m.time - performance.now() / 1000;
    if (!this.synced || sample > this.offset || sample < this.offset - 1) {
      this.offset = sample;
      this.synced = true;
    } else {
      this.offset += (sample - this.offset) * 0.05;
    }
  }

  now() {
    return performance.now() / 1000 + this.offset;
  }

  act(a: Action) {
    this.sendAction(a);
    return true;
  }

  update(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
