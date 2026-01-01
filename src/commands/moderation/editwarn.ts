import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags,
  InteractionContextType,
} from "discord.js";
import { Command } from "../../types/command";
import { db } from "../../utils/firebase";
import { sendModLog } from "../../utils/logUtils";
import { Timestamp } from "firebase-admin/firestore";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("editwarn")
    .setDescription("Edits the reason for a specific warning.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user whose warning you want to edit")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("case")
        .setDescription(
          "The case number of the warning to edit (from /warnings)"
        )
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName("new_reason")
        .setDescription("The new reason for the warning")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const target = interaction.options.getUser("target", true);
    const caseNumber = interaction.options.getInteger("case", true);
    const newReason = interaction.options.getString("new_reason", true);

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

      const warningToEditDoc = snapshot.docs[caseNumber - 1];
      const oldWarningData = warningToEditDoc.data();

      await warningToEditDoc.ref.update({
        reason: newReason,
        editedAt: Timestamp.now(),
        editedBy: interaction.user.tag,
      });

      await interaction.editReply({
        content: `Successfully edited Case #${caseNumber} for **${target.tag}**.\n> **Old Reason:** "${oldWarningData.reason}"\n> **New Reason:** "${newReason}"`,
      });

      await sendModLog({
        guild: interaction.guild,
        moderator: interaction.user,
        target: target,
        action: "Warning Edit",
        actionColor: "Blurple",
        reason: `Case #${caseNumber} edited.\n**Old:** ${oldWarningData.reason}\n**New:** ${newReason}`,
      });
    } catch (error) {
      console.error("Error editing warning:", error);
      await interaction.editReply({
        content: "An error occurred while trying to edit the warning.",
      });
    }
  },
};

export const data = command.data;
