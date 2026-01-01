import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags,
  Role,
  EmbedBuilder,
  ChannelType,
  TextChannel,
  InteractionContextType,
} from "discord.js";
import { Command } from "../../types/command";
import { db } from "../../utils/firebase";
import { watchedReactionMessages } from "../../utils/reactionCache";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("reactionrole")
    .setDescription("Manage reaction roles for the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a new reaction role.")
        // --- NEW/REQUIRED ---
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("The channel where the message is located")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("message_id")
            .setDescription("The ID of the message to watch")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("emoji")
            .setDescription(
              "The emoji to react with (e.g., 👍 or a custom emoji)"
            )
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("The role to grant")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a reaction role.")
        .addStringOption((option) =>
          option
            .setName("message_id")
            .setDescription("The ID of the message")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("emoji")
            .setDescription("The emoji of the rule to remove")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List all reaction roles on this server.")
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId || !interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const rrRef = db.collection("reaction_roles");

      if (subcommand === "add") {
        const channel = interaction.options.getChannel(
          "channel",
          true
        ) as TextChannel;
        const messageId = interaction.options.getString("message_id", true);
        const emoji = interaction.options.getString("emoji", true);
        const role = interaction.options.getRole("role", true) as Role;

        const botMember = await interaction.guild.members.fetch(
          interaction.client.user.id
        );
        if (role.position >= botMember.roles.highest.position) {
          await interaction.editReply(
            `❌ I cannot assign the **${role.name}** role because it is higher than or equal to my highest role.`
          );
          return;
        }
        if (role.id === interaction.guild.id) {
          await interaction.editReply("❌ You cannot use the @everyone role.");
          return;
        }

        let targetMessage;
        try {
          targetMessage = await channel.messages.fetch(messageId);
        } catch (error) {
          await interaction.editReply(
            `❌ Could not find message with ID \`${messageId}\` in ${channel}. Please check the ID and channel.`
          );
          return;
        }

        try {
          await targetMessage.react(emoji);
        } catch (error) {
          console.error("Error reacting to message:", error);
          await interaction.editReply(
            `❌ I failed to react with ${emoji}. Make sure it's a valid emoji or one I can access (if custom).`
          );
          return;
        }

        const emojiIdentifier = emoji.match(/<:.*?:(\d+)>/)?.[1] || emoji;

        const docId = `${interaction.guildId}-${messageId}-${emojiIdentifier}`;
        await rrRef.doc(docId).set({
          guildId: interaction.guildId,
          messageId: messageId,
          channelId: channel.id,
          emoji: emojiIdentifier,
          roleId: role.id,
        });
        watchedReactionMessages.add(messageId);

        await interaction.editReply(
          `✅ **Rule Added!** I've reacted to the message in ${channel} with ${emoji}. Users will now get the **${role.name}** role.`
        );
      } else if (subcommand === "remove") {
        const messageId = interaction.options.getString("message_id", true);
        const emoji = interaction.options.getString("emoji", true);
        const emojiIdentifier = emoji.match(/<:.*?:(\d+)>/)?.[1] || emoji;

        const docId = `${interaction.guildId}-${messageId}-${emojiIdentifier}`;
        const doc = await rrRef.doc(docId).get();

        if (!doc.exists) {
          await interaction.editReply(
            `❌ No reaction role rule was found for ${emoji} on message \`${messageId}\`.`
          );
          return;
        }

        await rrRef.doc(docId).delete();
        const remainingRules = await rrRef.where("messageId", "==", messageId).get();
        if (remainingRules.empty) {
            watchedReactionMessages.delete(messageId);
        }
        await interaction.editReply(
          `✅ **Rule Removed!** Users reacting with ${emoji} on message \`${messageId}\` will no longer get the role.`
        );
      } else if (subcommand === "list") {
        const snapshot = await rrRef
          .where("guildId", "==", interaction.guildId)
          .get();
        if (snapshot.empty) {
          await interaction.editReply(
            "There are no reaction roles set up on this server."
          );
          return;
        }

        let description = "";
        snapshot.forEach((doc) => {
          const data = doc.data();
          const emojiDisplay =
            data.emoji.length > 5 ? `<:emoji:${data.emoji}>` : data.emoji;
          const channelDisplay = data.channelId
            ? `<#${data.channelId}>`
            : "Unknown Channel";
          description += `**Msg:** \`${data.messageId}\` in ${channelDisplay}\n**Emoji:** ${emojiDisplay} | **Role:** <@&${data.roleId}>\n\n`;
        });

        const listEmbed = new EmbedBuilder()
          .setTitle("Reaction Roles")
          .setColor("Blue")
          .setDescription(description);

        await interaction.editReply({ embeds: [listEmbed] });
      }
    } catch (error) {
      console.error("Error in reactionrole command:", error);
      await interaction.editReply({
        content:
          "An error occurred. Please ensure the Message ID is correct and I have permissions.",
      });
    }
  },
};

export const data = command.data;
