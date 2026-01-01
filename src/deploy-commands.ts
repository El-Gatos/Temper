import { REST, Routes } from "discord.js";
import config from "./config";
import fs from "node:fs";
import path from "node:path";

if (!config.token || !config.clientId) {
  throw new Error(
    "Missing required environment variables (BOT_TOKEN, CLIENT_ID). Please check your .env file."
  );
}

const commands = [];
const commandsPath = path.join(__dirname, "commands");

function findCommandFiles(directory: string): string[] {
  let files: string[] = [];
  const items = fs.readdirSync(directory);
  for (const item of items) {
    const fullPath = path.join(directory, item);
    const stat = fs.lstatSync(fullPath);
    if (stat.isDirectory()) {
      files = files.concat(findCommandFiles(fullPath));
    } else if (item.endsWith(".ts") || item.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

const commandFiles = findCommandFiles(commandsPath);

for (const file of commandFiles) {
  const { data } = require(file);
  if (data) {
    commands.push(data.toJSON());
    console.log(`[DEPLOY] Found command for deployment: /${data.name}`);
  } else {
    console.log(
      `[WARNING] The command at ${file} is missing a "data" property.`
    );
  }
}

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`
    );

    const data: any = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands }
    );

    console.log(
      `✅ Successfully reloaded ${data.length} application (/) commands.`
    );
  } catch (error) {
    console.error(error);
  }
})();
