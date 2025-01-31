/* eslint-disable no-console */
import { createDiscordClient } from '@metafam/discord-bot';

import { CONFIG } from '../../config';
import { Player, PlayerRank_Enum } from '../../lib/autogen/hasura-sdk';
import { client } from '../../lib/hasuraClient';
import { TriggerPayload } from './types';

type RankRoleIds = { [rank in PlayerRank_Enum]: string };

export interface UpdateRole {
  playerId: string;
  previousRole: string | undefined;
  newRole: string;
}

export const updateDiscordRole = async (payload: TriggerPayload<Player>) => {
  if (CONFIG.nodeEnv !== 'production') return;

  const { old: oldPlayer, new: newPlayer } = payload.event.data;

  console.log(
    `updateDiscordRole action triggered for player (username=${newPlayer?.username})`,
  );

  try {
    if (newPlayer == null) return;

    const getPlayerResponse = await client.GetPlayer({
      playerId: newPlayer.id,
    });
    const playerDiscordId = getPlayerResponse.player_by_pk?.discord_id;
    if (playerDiscordId == null) return;

    const newRank = newPlayer?.rank;

    if (newRank == null) return;

    // hardcoded for now to metagame discord server
    const guildDiscordId = '629411177947987986';

    // instantiate discord client. We'll need serverId, playerId, and roleIds
    const discordClient = await createDiscordClient();

    const guild = await discordClient.guilds.fetch(guildDiscordId, true, true);
    if (guild == null) {
      console.warn(`No discord server found matching ${guildDiscordId}!`);
      return;
    }

    const getGuildResponse = await client.GetGuildMetadataByDiscordId({
      discordId: guildDiscordId,
    });
    const rankDiscordRoleIds = getGuildResponse.guild_metadata[0]
      ?.discord_metadata?.rankRoleIds as RankRoleIds;

    const discordPlayer = await guild.members.fetch(playerDiscordId);
    if (discordPlayer == null) {
      console.warn(
        `No discord player with ID ${playerDiscordId} found in server ${guild.name}!`,
      );
      return;
    }

    // We know the old value; try to remove that role
    let removedRole: PlayerRank_Enum | null = null;
    if (oldPlayer?.rank != null) {
      const rankId = rankDiscordRoleIds[oldPlayer.rank];
      try {
        // this actually throws a typeerror if the player doesn't actually have the role
        const success = await discordPlayer.roles.remove(rankId);
        if (success) {
          removedRole = oldPlayer.rank;
        }
      } catch (e) {
        console.error(e);
      }
    }
    // if not successful, attempt to remove all rank roles
    if (removedRole == null) {
      // eslint-disable-next-line no-restricted-syntax
      for (const rank in rankDiscordRoleIds) {
        if (Object.prototype.hasOwnProperty.call(rankDiscordRoleIds, rank)) {
          // eslint-disable-next-line no-await-in-loop
          const success = await discordPlayer.roles.remove([
            rankDiscordRoleIds[rank as PlayerRank_Enum],
          ]);
          if (success) {
            removedRole = rank as PlayerRank_Enum;
            break;
          }
        }
      }
    }

    if (removedRole) {
      console.log(`${newPlayer?.username}: removed role ${removedRole}`);
    }

    // Add the new rank.
    const discordRoleForRank = rankDiscordRoleIds[newRank];
    if (discordRoleForRank == null) {
      console.warn(`Discord role associated with ${newRank} was not found!`);
    } else {
      await discordPlayer.roles.add([discordRoleForRank]);
      console.log(`${newPlayer?.username}: added role ${newRank}`);
    }
  } catch (e) {
    console.error(e);
  }
};
