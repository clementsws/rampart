import type { Accounts } from './accounts';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ACCOUNTS: DurableObjectNamespace<Accounts>;
  ASSETS: Fetcher;
}

/** Every commander lives in one accounts object (a handful of friends fits many times over). */
export const accountsOf = (env: Env) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName('realm'));
