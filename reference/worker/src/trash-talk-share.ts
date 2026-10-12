import { pregameShareTitle } from '../../packages/trash-talk/src/share-title';
import type { Env } from './env';
import type { TrashTalkState } from '../../packages/trash-talk/src';
import { trashStateKey } from './jobs/trash-talk';
import { shareMetaKey, type ShareMetadata } from './share-images';
import teams from '../../packages/contracts/src/nfl-teams.json';

export function teamNamesTitle(title: string) {
  return title
    .replace(/ \| FanLift$/, '')
    .split(/ vs\.? /)
    .map(
      (name) =>
        teams.find(
          (team) =>
            team.displayName === name || `${team.city} ${team.name}` === name,
        )?.name ?? name,
    )
    .join(' vs ');
}

export async function trashTalkSharePreview(
  env: Env,
  gameId: string,
  imageId: string | undefined,
  origin: string,
  score?: string,
  pregame?: string,
) {
  if (
    !imageId ||
    imageId.length > 160 ||
    !imageId.startsWith(`${gameId}-`) ||
    !/^[a-zA-Z0-9-]+$/.test(imageId)
  )
    return;
  try {
    const state = await (
      await env.ASSETS?.get(trashStateKey(imageId))
    )?.json<TrashTalkState>();
    const result = state?.status === 'complete' ? state.result : undefined;
    if (!result || typeof result.text !== 'string') return;
    const extension = ['png', 'jpg'].find(
      (ext) => result.url === `/api/assets/trash-talk/${imageId}.${ext}`,
    );
    if (!extension) return;
    const gameMeta = result.gameTitle
      ? undefined
      : await (
          await env.ASSETS?.get(shareMetaKey(gameId))
        )?.json<ShareMetadata>();
    const title =
      result.gameTitle ??
      gameMeta?.title.replace(/ \| FanLift$/, '').replace(' vs. ', ' vs ');
    if (!title) return;
    const namesTitle = teamNamesTitle(title);
    const names = namesTitle.split(' vs ');
    const scores = score?.match(/^(\d{1,3})-(\d{1,3})$/);
    const pregameTitle = pregameShareTitle(namesTitle, pregame);
    const scoredTitle =
      scores && names.length === 2
        ? `${names[0]} ${Number(scores[1])} - ${Number(scores[2])} ${names[1]}`
        : namesTitle;
    const scoreQuery = scores
      ? `&score=${Number(scores[1])}-${Number(scores[2])}`
      : '';
    return {
      meta: {
        title: pregameTitle ?? scoredTitle,
        description: `${result.label} · Trash Talk on FanLift. Follow the game.`,
        alt: result.text,
        width: 1024,
        height: 1024,
      },
      image: `${origin}${result.url}`,
      url: `${origin}/games/${gameId}?trashTalk=${encodeURIComponent(imageId)}${pregameTitle ? `&pregame=${pregame}` : scoreQuery}`,
      contentType: extension === 'jpg' ? 'image/jpeg' : 'image/png',
    };
  } catch {
    return;
  }
}
