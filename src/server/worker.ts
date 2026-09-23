import type { Env } from './room';

export { GameRoom } from './room';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const room = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4,8})\/ws$/);
    if (room) {
      const id = env.ROOMS.idFromName(room[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true });
    }
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
