import type { ExpertConfig } from '../../packages/expert/src';
import type { Env } from './env';
import type { FeaturedRegistry } from './featured';
export const room = (env: Env, id = 'nfl-demo') =>
  env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(id));
export const registryRoom = (env: Env) => room(env, 'featured-registry');
export async function registry(
  env: Env,
  refresh = false,
): Promise<FeaturedRegistry> {
  return (
    await registryRoom(env).fetch(
      new Request(`https://room/registry${refresh ? '/refresh' : ''}`),
    )
  ).json();
}
export const allowed = async (env: Env, id: string) =>
  id === 'nfl-demo' || (await registry(env)).known.includes(id);
export const featured = async (env: Env, id: string) =>
  (await registry(env)).selected.includes(id);
export const roomRequest = (id: string, path: string, headers?: Headers) =>
  new Request(`https://room/${path}?gameId=${id}`, { headers });
export const configRoom = (env: Env) => room(env, 'expert-config');
export async function expertConfig(env: Env): Promise<ExpertConfig> {
  return (
    await configRoom(env).fetch(new Request('https://room/expert-config'))
  ).json();
}
