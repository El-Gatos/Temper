import {
  Collection,
  Message,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import { db } from "../utils/firebase";
import { sendModLog } from "../utils/logUtils";
import { Timestamp } from "firebase-admin/firestore";

interface GuildSettings {
  bannedWords: string[];
  blockInvites: boolean;
  massMentionLimit: number;
}
const guildSettingsCache = new Map<string, GuildSettings>();

async function fetchSettings(guildId: string) {
  if (guildSettingsCache.has(guildId)) {
    return guildSettingsCache.get(guildId);
  }
  const doc = await db.collection("guilds").doc(guildId).get();
  const settings = doc.data()?.automod || {
    bannedWords: [],
    blockInvites: false,
    massMentionLimit: 0,
  };
  guildSettingsCache.set(guildId, settings);
  setTimeout(() => guildSettingsCache.delete(guildId), 5 * 60 * 1000); // 5 min cache
  return settings;
}

const userSpamTracker = new Collection<
  string,
  { msgCount: number; lastMsgTime: number }
>();

setInterval(() => {
  const now = Date.now();
  userSpamTracker.forEach((data, key) => {
    if (now - data.lastMsgTime > SPAM_TIMEFRAME) {
      userSpamTracker.delete(key);
    }
  });
}, 10_000); 

const SPAM_THRESHOLD = 5;
const SPAM_TIMEFRAME = 3000;
const SPAM_MUTE_DURATION_MS = 5 * 60 * 1000;
const SPAM_MUTE_DURATION_STRING = "5 minutes";

async function deleteAndWarn(
  message: Message,
  reason: string,
  logAction: string,
  logColor: "DarkRed" | "DarkOrange"
) {
  if (!message.channel.isTextBased()) return;

  try {
    const author = message.author;
    const guild = message.guild!;

    await message.delete();
    const channel = message.channel as TextChannel; // Cast here
    const reply = await channel.send(
      `${author}, your message was removed. Reason: ${reason}`
    );
    setTimeout(() => reply.delete().catch(console.error), 5000);

    const logRef = db.collection("guilds").doc(guild.id).collection("mod-logs");
    await logRef.add({
      action: "auto-warn",
      targetId: author.id,
      targetTag: author.tag,
      moderatorId: message.client.user.id,
      moderatorTag: message.client.user.tag,
      reason: reason,
      timestamp: Timestamp.now(),
    });

    await sendModLog({
      guild: guild,
      moderator: message.client.user,
      target: author,
      action: logAction,
      actionColor: logColor,
      reason: reason,
    });
  } catch (error) {
    console.error(`Error during ${logAction} action:`, error);
  }
}

export async function handleMessage(message: Message) {
  if (message.author.bot || !message.guild || !message.member) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages))
    return;

  const settings = await fetchSettings(message.guild.id);
  const userKey = `${message.guild.id}-${message.author.id}`;

  const now = Date.now();
  const userData = userSpamTracker.get(userKey) || {
    msgCount: 0,
    lastMsgTime: now,
  };

  if (now - userData.lastMsgTime > SPAM_TIMEFRAME) {
      userData.msgCount = 1;
      // Reset timer is correct here
    } else {
      userData.msgCount++;
      // OPTIONAL: Uncomment the line below if you want to be stricter (Sliding Window).
      // It means 5 messages in a row where NONE are more than 3s apart.
      // userData.lastMsgTime = now; 
    }
    
    // Update the time for the cleanup interval so they don't get deleted while active
    userData.lastMsgTime = now; 
    userSpamTracker.set(userKey, userData);

  if (userData.msgCount >= SPAM_THRESHOLD) {
    if (!message.channel.isTextBased()) return;
    try {
      if (
        !message.member.isCommunicationDisabled() &&
        message.member.moderatable
      ) {
        await message.member.timeout(
          SPAM_MUTE_DURATION_MS,
          "Automatic spam detection."
        );

        const channel = message.channel as TextChannel; // Cast here
        const reply = await channel.send(
          `${message.author} has been automatically muted for spamming.`
        );
        setTimeout(() => reply.delete().catch(console.error), 5000);

        await sendModLog({
          guild: message.guild,
          moderator: message.client.user,
          target: message.author,
          action: "Auto-Mute (Spam)",
          actionColor: "DarkPurple",
          reason: "User sent messages too quickly.",
          duration: SPAM_MUTE_DURATION_STRING,
        });
      }
    } catch (error) {
      console.error("Error during anti-spam mute:", error);
    }
    userSpamTracker.delete(userKey);
    return;
  }

  if (settings?.blockInvites) {
    const inviteRegex = /(discord\.(gg|com)\/(invite\/)?[a-zA-Z0-9]{2,25})/i;
    if (inviteRegex.test(message.content)) {
      await deleteAndWarn(
        message,
        "Discord invites are not allowed here.",
        "Auto-Warn (Invite Link)",
        "DarkOrange"
      );
      return;
    }
  }

  const mentionLimit = settings?.massMentionLimit || 0;
  if (mentionLimit > 0) {
    const mentionCount = message.mentions.users.size;
    if (mentionCount > mentionLimit) {
      await deleteAndWarn(
        message,
        `Mass mentions are not allowed (Limit: ${mentionLimit}).`,
        "Auto-Warn (Mass Mention)",
        "DarkOrange"
      );
      return;
    }
  }

  const bannedWords = settings?.bannedWords || [];
  if (bannedWords.length === 0) return;

  let foundWord: string | undefined;
  for (const word of bannedWords) {
    const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedWord}\\b`, "i"); // 'i' for case-insensitive

    if (regex.test(message.content)) {
      foundWord = word;
      break;
    }
  }

  if (foundWord) {
    await deleteAndWarn(
      message,
      `Automatic detection of blacklisted word: "${foundWord}"`,
      "Auto-Warn (Banned Word)",
      "DarkRed"
    );
  }
}
