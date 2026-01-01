import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags,
  InteractionContextType,
} from "discord.js";
import { Command } from "../../types/command";
import { db } from "../../utils/firebase";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("delwarn")
    .setDescription("Deletes a specific warning for a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user whose warning you want to delete")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("case")
        .setDescription(
          "The case number of the warning to delete (from /warnings)"
        )
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const target = interaction.options.getUser("target", true);
    const caseNumber = interaction.options.getInteger("case", true);

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

      if (caseNumber > snapshot.size) {
        await interaction.editReply({
          content: `Invalid case number. **${target.tag}** only has ${snapshot.size} warning(s).`,
        });
        return;
      }

      const warningToDeleteDoc = snapshot.docs[caseNumber - 1];
      const warningData = warningToDeleteDoc.data();

      await warningToDeleteDoc.ref.delete();

      await interaction.editReply({
        content: `Successfully deleted Case #${caseNumber} for **${target.tag}**.\n> Reason was: "${warningData.reason}"`,
      });
    } catch (error) {
      console.error("Error deleting warning:", error);
      await interaction.editReply({
        content: "An error occurred while trying to delete the warning.",
      });
    }
  },
};

export const data = command.data;
