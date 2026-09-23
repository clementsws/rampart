import { ClientMsg, ServerMsg } from '../shared/protocol';

/** WebSocket to a room, with automatic reconnection. */
export class Net {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  rtt = 0;
  connected = false;

  constructor(
    readonly code: string,
    private readonly hello: () => ClientMsg,
    private readonly onMsg: (m: ServerMsg) => void,
    private readonly onStatus: (connected: boolean) => void,
  ) {
    this.open();
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/room/${encodeURIComponent(this.code)}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.onStatus(true);
      this.send(this.hello());
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 3000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'pong') this.rtt = performance.now() - m.c;
      this.onMsg(m);
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.connected = false;
      if (this.ws !== ws) return;
      this.onStatus(false);
      if (this.closed || ev.code === 4000) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.closed && this.open(), delay);
    };
  }

  send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
