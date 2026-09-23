import { Env, accountsOf } from './env';

export { Accounts } from './accounts';
export { GameRoom } from './room';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const bearer = (req: Request) => req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? '';

async function body(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('Content-Length') ?? 0) > 16384) return {};
  try {
    const v = await req.json();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Accounts API: sign up / in / out, your profile and cosmetics, game results, Hall of Fame. */
async function accountApi(req: Request, env: Env, path: string): Promise<Response> {
  const acc = accountsOf(env);
  const post = req.method === 'POST';
  switch (path) {
    case '/api/account/signup':
    case '/api/account/login': {
      if (!post) break;
      const b = await body(req);
      const r = path.endsWith('signup') ? await acc.signup(b.name, b.password) : await acc.login(b.name, b.password);
      return r.ok ? json({ token: r.token, profile: r.profile }) : json({ error: r.error }, 400);
    }
    case '/api/account/logout':
      if (!post) break;
      await acc.logout(bearer(req));
      return json({ ok: true });
    case '/api/account/me': {
      const p = await acc.me(bearer(req));
      return p ? json({ profile: p }) : json({ error: 'Not signed in' }, 401);
    }
    case '/api/account/look': {
      if (!post) break;
      const p = await acc.wear(bearer(req), await body(req));
      return p ? json({ profile: p }) : json({ error: 'Not signed in' }, 401);
    }
    case '/api/account/games': {
      if (!post) break;
      const token = bearer(req);
      const r = await acc.submit(token, await body(req));
      if (r) return json(r);
      return (await acc.me(token)) ? json({ error: 'Bad game record' }, 400) : json({ error: 'Not signed in' }, 401);
    }
    case '/api/hall':
      return json({ hall: await acc.hall() });
  }
  return json({ error: 'Not found' }, 404);
}

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
    if (url.pathname.startsWith('/api/account/') || url.pathname === '/api/hall') {
      return accountApi(request, env, url.pathname);
    }
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
