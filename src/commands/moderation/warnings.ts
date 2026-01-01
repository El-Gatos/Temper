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
    .setName("warnings")
    .setDescription("Checks a user's warning history.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user to check warnings for")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) return;

    const target = interaction.options.getUser("target", true);

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const logsRef = db
        .collection("guilds")
        .doc(interaction.guildId)
        .collection("mod-logs");
      const snapshot = await logsRef
        .where("targetId", "==", target.id)
        .where("action", "==", "warn")
        .orderBy("timestamp", "desc")
        .get();

      if (snapshot.empty) {
        await interaction.editReply({
          content: `No warnings found for **${target.tag}**.`,
        });
        return;
      }

      const warningsEmbed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setAuthor({
          name: `Warning History for ${target.tag}`,
          iconURL: target.displayAvatarURL(),
        })
        .setTimestamp();

      let description = "";
      let count = 0;
      snapshot.forEach((doc) => {
        count++;
        const data = doc.data();
        const timestamp = (data.timestamp as Timestamp).toDate();
        const discordTimestamp = `<t:${Math.floor(
          timestamp.getTime() / 1000
        )}:f>`;

        description += `**Case ${count}** - ${discordTimestamp}\n`;
        description += `**Moderator:** ${data.moderatorTag}\n`;
        description += `**Reason:** ${data.reason}\n\n`;
      });

      warningsEmbed.setDescription(description);
      warningsEmbed.setFooter({ text: `Total Warnings: ${count}` });

      await interaction.editReply({ embeds: [warningsEmbed] });
    } catch (error) {
      console.error("Error fetching warnings:", error);
      await interaction.editReply({
        content: "An error occurred while fetching the user's warnings.",
      });
    }
  },
};

export const data = command.data;
