import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  InteractionContextType,
} from "discord.js";
import { Command } from "../../types/command";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Displays information about a user.")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user to get info about (defaults to you)")
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    // Get the member, or default to the user who ran the command
    const targetMember = (interaction.options.getMember("target") ||
      interaction.member) as GuildMember;
    const user = targetMember.user;

    // Format roles
    const roles = targetMember.roles.cache
      .filter((role) => role.id !== interaction.guild!.id) // Filter out @everyone
      .map((role) => role.toString())
      .join(", ");

    const infoEmbed = new EmbedBuilder()
      .setColor(targetMember.displayHexColor || "Blue")
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "User", value: `${user} (${user.id})`, inline: false },
        {
          name: "Account Created",
          value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, // e.g., "2 years ago"
          inline: true,
        },
        {
          name: "Joined Server",
          value: targetMember.joinedAt
            ? `<t:${Math.floor(targetMember.joinedAt.getTime() / 1000)}:R>`
            : "Unknown",
          inline: true,
        },
        {
          name: "Roles",
          value: roles.length > 0 ? roles : "None",
          inline: false,
        }
      )
      .setFooter({ text: `ID: ${user.id}` })
      .setTimestamp();

    await interaction.reply({ embeds: [infoEmbed] });
  },
};

export const data = command.data;
