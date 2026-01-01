import {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  Partials,
  EmbedBuilder,
  Message,
  PermissionFlagsBits,
  TextChannel,
  Guild,
  GuildMember,
  Interaction,
  Role,
  User,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  CacheType,
  MessageFlags,
} from "discord.js";

import config from "./config";
import { Command } from "./types/command";
import * as bcrypt from "bcrypt";
import fs from "node:fs";
import path from "node:path";
import { handleMessage } from "./events/automod";
import { db } from "./utils/firebase";
import { FieldValue } from "firebase-admin/firestore";
import { watchedReactionMessages } from "./utils/reactionCache";

class AegisClient extends Client {
  commands: Collection<string, Command> = new Collection();
}

const client = new AegisClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
});

const commandsPath = path.join(__dirname, "commands");
const verificationCodes = new Map();

function loadCommands(directory: string) {
  const files = fs.readdirSync(directory);
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = fs.lstatSync(fullPath);
    if (stat.isDirectory()) {
      loadCommands(fullPath);
    } else if (file.endsWith(".ts") || file.endsWith(".js")) {
      const { command } = require(fullPath);
      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`[INFO] Loaded command: /${command.data.name}`);
      } else {
        console.log(
          `[WARNING] The command at ${fullPath} is missing a required "data" or "execute" property.`
        );
      }
    }
  }
}

loadCommands(commandsPath);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);

  try {
    const snapshot = await db.collection("reaction_roles").get();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.messageId) {
        watchedReactionMessages.add(data.messageId);
      }
    });
    console.log(`[Cache] Loaded ${watchedReactionMessages.size} reaction role messages.`);
  } catch (error) {
    console.error("Failed to load reaction role cache:", error);
  }

  console.log(`Im online`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.guild) {
    await handleMessage(message);
  } else {
    if (message.content.startsWith("!recover")) {
      await handleRecoveryDm(message);
    }
  }
});

async function handleRecoveryDm(message: Message) {
  const token = message.content.slice(9).trim();
  if (!token || !token.includes(".")) {
    await message.author.send(
      "Invalid token format. It should look like `[GuildID].[SecretKey]`."
    );
    return;
  }

  const [guildId, secretKey] = token.split(".", 2);
  if (!guildId || !secretKey) {
    await message.author.send("Invalid token format.");
    return;
  }

  try {
    const guildDocRef = db.collection("guilds").doc(guildId);
    const doc = await guildDocRef.get();
    const storedHash = doc.data()?.settings?.recoveryTokenHash;

    if (!storedHash) {
      await message.author.send(
        "Invalid or expired token. No recovery token is set for that server."
      );
      return;
    }

    const isValid = await bcrypt.compare(secretKey, storedHash);
    if (!isValid) {
      await message.author.send("Invalid or expired token.");
      return;
    }

    await message.author.send(
      `Token accepted for server ${
        doc.data()?.name || guildId
      }. Granting access...`
    );

    const guild = await message.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(message.author.id);
    if (!member) {
      await message.author.send(
        "I found the server, but you are not a member. Please join the server and try again."
      );
      return;
    }

    let recoveryRole = guild.roles.cache.find(
      (r) => r.name === "Recovery Admin"
    );
    if (!recoveryRole) {
      await message.author.send(
        'The "Recovery Admin" role was not found. I will try to create it...'
      );
      const botMember = guild.members.me!;
      if (!botMember.permissions.has("ManageRoles")) {
        await message.author.send(
          `Error: I do not have the "Manage Roles" permission in ${guild.name} to create the recovery role.`
        );
        return;
      }

      try {
        recoveryRole = await guild.roles.create({
          name: "Recovery Admin",
          permissions: [PermissionFlagsBits.Administrator],
          position: botMember.roles.highest.position - 1,
          reason: "Automatic creation for recovery command",
        });
        await message.author.send(
          `Successfully created the "Recovery Admin" role.`
        );
      } catch (createError) {
        console.error("Failed to create recovery role:", createError);
        await message.author.send(
          `Error: I tried to create the role but failed. Please check my permissions. I need "Manage Roles" and "Administrator".`
        );
        return;
      }
    }

    if (recoveryRole.position >= guild.members.me!.roles.highest.position) {
      await message.author.send(
        `Error: I cannot assign the "Recovery Admin" role. It is higher than my highest role. Please fix its position in the server settings.`
      );
      return;
    }

    await member.roles.add(recoveryRole, "Used one-time recovery token");
    await guildDocRef.update({
      "settings.recoveryTokenHash": FieldValue.delete(),
    });

    const logChannelId = doc.data()?.settings?.logChannelId;
    if (logChannelId) {
      const logChannel = (await guild.channels.fetch(
        logChannelId
      )) as TextChannel;
      const logEmbed = new EmbedBuilder()
        .setColor("Red")
        .setAuthor({ name: "CRITICAL SECURITY EVENT" })
        .setTitle("Recovery Token Used")
        .addFields(
          { name: "User", value: `${member.user.tag} (${member.id})` },
          {
            name: "Action",
            value: `The one-time recovery token was successfully used and has been **permanently invalidated**.\nThe user was granted the \`${recoveryRole.name}\` role.`,
          }
        )
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }

    await message.author.send(
      `✅ You have been granted the "Recovery Admin" role in **${guild.name}**. The token has been used and is now invalid.`
    );
  } catch (error) {
    console.error("Error in handleRecoveryDm:", error);
    await message.author.send(
      "An unexpected error occurred. Could not fetch server or role. Please try again."
    );
  }
}

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  try {
    const guildDocRef = db.collection("guilds").doc(member.guild.id);
    const doc = await guildDocRef.get();
    const autoRoleId = doc.data()?.settings?.autoRoleId;
    if (!autoRoleId) return;

    const role = member.guild.roles.cache.get(autoRoleId);
    if (!role) {
      console.warn(
        `[Autorole] Role ID ${autoRoleId} not found in guild ${member.guild.name}. Removing from settings.`
      );
      await guildDocRef.set(
        { settings: { autoRoleId: null } },
        { merge: true }
      );
      return;
    }

    if (
      member.guild.members.me?.permissions.has("ManageRoles") &&
      role.position < member.guild.members.me.roles.highest.position
    ) {
      await member.roles.add(role, "Automatic role assignment");
    } else {
      console.error(
        `[Autorole] Failed to assign role ${role.name} in ${member.guild.name}. Bot lacks permissions or role is too high.`
      );
    }
  } catch (error) {
    console.error(
      `[Autorole] Error assigning role in ${member.guild.name}:`,
      error
    );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId === "start_verification") {
    if (!interaction.guildId) return;

    try {
      const code = Math.random().toString().substring(2, 7);
      verificationCodes.set(interaction.user.id, code);
      setTimeout(() => {
        verificationCodes.delete(interaction.user.id);
      }, 5 * 60 * 1000);
      const modal = new ModalBuilder()
        .setCustomId("verification_modal")
        .setTitle("Are you human?");

      const codeDisplay = new TextInputBuilder()
        .setCustomId("verification_code_display")
        .setLabel("Please type this exact code below:")
        .setValue(code)
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const codeInput = new TextInputBuilder()
        .setCustomId("verification_code_input")
        .setLabel("Enter the code here")
        .setPlaceholder("e.g., 12345")
        .setStyle(TextInputStyle.Short)
        .setMinLength(5)
        .setMaxLength(5)
        .setRequired(true);

      const firstRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
        codeDisplay
      );
      const secondRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
        codeInput
      );

      modal.addComponents(firstRow, secondRow);
      await interaction.showModal(modal);
    } catch (error) {
      console.error("Failed to show verification modal:", error);
      await interaction.reply({
        content: "An error occurred. Please try again.",
        ephemeral: true,
      });
    }
    return;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId === "verification_modal"
  ) {
    if (!interaction.guild || !interaction.guildId || !interaction.member) {
      return;
    }

    const submittedCode = interaction.fields.getTextInputValue(
      "verification_code_input"
    );
    const correctCode = verificationCodes.get(interaction.user.id);

    if (submittedCode === correctCode) {
      verificationCodes.delete(interaction.user.id);

      const doc = await db.collection("guilds").doc(interaction.guildId).get();
      const roleId = doc.data()?.settings?.verificationRoleId;

      if (!roleId) {
        await interaction.reply({
          content:
            "Verification passed, but the admin has not set a role. Please contact a moderator.",
          ephemeral: true,
        });
        return;
      }

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) {
        await interaction.reply({
          content:
            "Verification passed, but the configured role no longer exists. Please contact a moderator.",
          ephemeral: true,
        });
        return;
      }

      try {
        const member = interaction.member as GuildMember;
        await member.roles.add(role, "Passed CAPTCHA verification");
        await interaction.reply({
          content: `✅ **Verification Successful!** You now have access to the server.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error("Failed to assign verification role:", error);
        await interaction.reply({
          content:
            "Verification passed, but I failed to assign the role. My permissions might be too low. Please contact a moderator.",
          ephemeral: true,
        });
      }
    } else {
      await interaction.reply({
        content: `❌ **Verification Failed.** The code was incorrect. Please click the button to try again.`,
        ephemeral: true,
      });
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = (interaction.client as AegisClient).commands.get(
    interaction.commandName
  );
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);

    if (error && typeof error === "object" && "code" in error) {
      const discordErrorCode = error.code as number;
      if (discordErrorCode === 10062 || discordErrorCode === 40060) {
        console.log(
          `[INFO] Suppressing reply for a dead (10062) or duplicate (40060) interaction.`
        );
        return;
      }
    }

    const errorMessage = {
      content: "There was an error while executing this command!",
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
});

function getEmojiIdentifier(reaction: any): string | null {
  if (reaction.emoji.id) return reaction.emoji.id;
  if (reaction.emoji.name) return reaction.emoji.name;
  return null;
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.partial) await user.fetch();
  if (user.bot) return;
  if (!reaction.message.guild) return;
  if (!watchedReactionMessages.has(reaction.message.id)) return;

  const emoji = getEmojiIdentifier(reaction);
  if (!emoji) return;

  const docId = `${reaction.message.guild.id}-${reaction.message.id}-${emoji}`;
  const ruleDoc = await db.collection("reaction_roles").doc(docId).get();
  if (!ruleDoc.exists) return;

  try {
    const rule = ruleDoc.data();
    const role = reaction.message.guild.roles.cache.get(rule!.roleId);
    const member = await reaction.message.guild.members.fetch(user.id);

    if (role && member) {
      if (
        reaction.message.guild.members.me!.permissions.has("ManageRoles") &&
        role.position <
          reaction.message.guild.members.me!.roles.highest.position
      ) {
        await member.roles.add(role, "Reaction Role");
      } else {
        console.warn(
          `[ReactionRole] Failed to add role ${role.name} to ${member.user.tag}. Bot perms/hierarchy issue.`
        );
      }
    }
  } catch (error) {
    console.error("Error adding reaction role:", error);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.partial) await user.fetch();
  if (user.bot) return;
  if (!reaction.message.guild) return;
  if (!watchedReactionMessages.has(reaction.message.id)) return;

  const emoji = getEmojiIdentifier(reaction);
  if (!emoji) return;

  const docId = `${reaction.message.guild.id}-${reaction.message.id}-${emoji}`;
  const ruleDoc = await db.collection("reaction_roles").doc(docId).get();
  if (!ruleDoc.exists) return;

  try {
    const rule = ruleDoc.data();
    const role = reaction.message.guild.roles.cache.get(rule!.roleId);
    const member = await reaction.message.guild.members.fetch(user.id);

    if (role && member) {
      if (
        reaction.message.guild.members.me!.permissions.has("ManageRoles") &&
        role.position <
          reaction.message.guild.members.me!.roles.highest.position
      ) {
        await member.roles.remove(role, "Reaction Role");
      } else {
        console.warn(
          `[ReactionRole] Failed to remove role ${role.name} from ${member.user.tag}. Bot perms/hierarchy issue.`
        );
      }
    }
  } catch (error) {
    console.error("Error removing reaction role:", error);
  }
});

client.login(config.token);
