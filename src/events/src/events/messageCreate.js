import { getEmoji } from '../handlers/emoji.js';
import { PREFIX } from '../utils/config.js';

export default {
  name: 'messageCreate',
  once: false,
  async execute(message, client) {
    if (message.author.bot) return;
    
    // Agar message pehle hi process ho chuka hai toh rok do
    if (message.commandProcessed) return;

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = client.prefixCommands.get(commandName);
    if (!command) return;

    // Mark kar do ki process ho gaya hai
    message.commandProcessed = true;

    try {
      await command.prefixExecute(message, args, client);
    } catch (err) {
      console.error(err);
      await message.reply(`${getEmoji('error')} Something went wrong.`).catch(() => {});
    }
  },
};

