import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
  InteractionContextType,
} from "discord.js";
import { Command } from "../../types/command";
import { db } from "../../utils/firebase";
import { Timestamp } from "firebase-admin/firestore";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("caselogs")
    .setDescription("Checks the server's complete moderation history.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("The page number to view")
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) return;

    const page = interaction.options.getInteger("page") ?? 1;
    const logsPerPage = 10;
    const offset = (page - 1) * logsPerPage;

    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      const logsRef = db
        .collection("guilds")
        .doc(interaction.guildId)
        .collection("mod-logs");

      // Get total count for pagination
      const totalLogsSnapshot = await logsRef.count().get();
      const totalLogs = totalLogsSnapshot.data().count;
      if (totalLogs === 0) {
        await interaction.editReply({
          content: "No moderation history found for this server.",
        });
        return;
      }
      const totalPages = Math.ceil(totalLogs / logsPerPage);

      if (page > totalPages) {
        await interaction.editReply({
          content: `Invalid page. This server only has ${totalPages} page(s) of logs.`,
        });
        return;
      }

      const snapshot = await logsRef
        .orderBy("timestamp", "desc")
        .limit(logsPerPage)
        .offset(offset)
        .get();

      const historyEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({
          name: `Server Moderation History - Page ${page}/${totalPages}`,
          iconURL: interaction.guild?.iconURL() || undefined,
        })
        .setTimestamp()
        .setFooter({ text: `Total Cases: ${totalLogs}` });

      let description = "";
      snapshot.forEach((doc) => {
        const data = doc.data();
        const timestamp = (data.timestamp as Timestamp).toDate();
        const discordTimestamp = `<t:${Math.floor(
          timestamp.getTime() / 1000
        )}:R>`;

        description += `**Action:** ${data.action.toUpperCase()} ${discordTimestamp}\n`;
        description += `**Target:** ${data.targetTag} (${data.targetId})\n`;
        description += `**Moderator:** ${data.moderatorTag}\n`;
        description += `**Reason:** ${data.reason}\n\n`;
      });
      historyEmbed.setDescription(description);

      await interaction.editReply({ embeds: [historyEmbed] });
    } catch (error) {
      console.error("Error fetching mod history:", error);
      await interaction.editReply({
        content: "An error occurred while fetching the server's history.",
      });
    }
  },
};

export const data = command.data;
