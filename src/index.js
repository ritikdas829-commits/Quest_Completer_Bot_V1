import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import deployCommands from './utils/deployCommands.js';
import { makeTokenStore, handlePlatformButton, handleInviteJoin, handleInviteLeave, cacheGuildInvites } from './commands/questCommands.js';
import { writeFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const col = {
    reset:  '\x1b[0m', bright: '\x1b[1m', cyan: '\x1b[96m',
    blue:   '\x1b[34m', white: '\x1b[97m', purple: '\x1b[35m',
    green:  '\x1b[92m', dim:   '\x1b[90m',
};

function banner() {
    const lines = [
        '',
        `${col.cyan}${col.bright}   ██████╗  ██████╗██╗   ██╗ ██╗${col.reset}`,
        `${col.cyan}${col.bright}  ██╔═══██╗██╔════╝██║   ██║███║${col.reset}`,
        `${col.blue}${col.bright}  ██║   ██║██║     ██║   ██║╚██║${col.reset}`,
        `${col.blue}${col.bright}  ██║▄▄ ██║██║     ╚██╗ ██╔╝ ██║${col.reset}`,
        `${col.white}${col.bright}  ╚██████╔╝╚██████╗ ╚████╔╝  ██║${col.reset}`,
        `${col.white}${col.bright}   ╚══▀▀═╝  ╚═════╝  ╚═══╝   ╚═╝${col.reset}`,
        '',
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        `  ${col.green}●${col.reset} ${col.white}Quest Completer V1${col.reset}  ${col.dim}|${col.reset}   ${col.white}dsc.gg/synoraxdev${col.reset}`,
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        '',
    ];
    for (const line of lines) process.stdout.write(line + '\n');
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('DISCORD_TOKEN is not set.'); process.exit(1); }

// Ensure data files exist
if (!existsSync('tokens.json'))    writeFileSync('tokens.json', '{}');
if (!existsSync('autoquest.json')) writeFileSync('autoquest.json', '[]');

banner();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // <--- Yahan add kar diya hai (Privileged Intent zaroori hai)
        GatewayIntentBits.GuildInvites, // <--- Invites track karne ke liye zaroori hai
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.commands       = new Collection();
client.prefixCommands = new Collection();
client.tokenStore     = makeTokenStore(TOKEN);

// Client ready hone par invites cache karein
client.once('ready', async () => {
    await cacheGuildInvites(client);
    console.log(`Bot logged in as ${client.user.tag}`);
});

// Member join hone par invite track karein
client.on('guildMemberAdd', async (member) => {
    await handleInviteJoin(member);
});

// Member leave hone par invite count update karein aur role check karein
client.on('guildMemberRemove', async (member) => {
    await handleInviteLeave(member);
});

// 1. Prefix Message Handler
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = '.'; 
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.prefixCommands.get(commandName) || client.commands.get(commandName);
    if (!command) return;

    try {
        if (typeof command.prefixExecute === 'function') {
            await command.prefixExecute(message, args, client);
        } else if (typeof command.execute === 'function') {
            await command.execute(message, client);
        }
    } catch (error) {
        console.error(`Error executing prefix command ${commandName}:`, error);
        await message.reply('There was an error executing that command!').catch(() => {});
    }
});

// 2. Interaction Handler
client.on('interactionCreate', async (interaction) => {
    // --- BUTTON HANDLER ---
    if (interaction.isButton()) {
        try {
            if (interaction.customId === 'link_prompt') {
                const { handleLinkPromptButton } = await import('./commands/questCommands.js');
                await handleLinkPromptButton(interaction);
                return;
            }
            if (['btn_pc', 'btn_android', 'btn_ios'].includes(interaction.customId)) {
                await handlePlatformButton(interaction);
                return;
            }
        } catch (error) {
            console.error("Button interaction error:", error);
        }
        return;
    }

    // --- MODAL SUBMIT ---
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'link_token_modal') {
            const { handleLinkModal } = await import('./commands/questCommands.js');
            await handleLinkModal(interaction, client);
            return;
        }
    }

    // --- SLASH COMMAND HANDLER ---
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(`Error executing slash command ${interaction.commandName}:`, error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true }).catch(() => {});
        }
    }
});

// Command Loader
const commandFiles = readdirSync(join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const mod = await import(pathToFileURL(join(__dirname, 'commands', file)).href);
    if (mod.default) {
        const cmd = mod.default;
        if (cmd?.data)   client.commands.set(cmd.data.name, cmd);
        if (cmd?.prefix) client.prefixCommands.set(cmd.prefix, cmd);
        if (cmd?.data?.name) client.prefixCommands.set(cmd.data.name, cmd);
    }
    for (const [key, cmd] of Object.entries(mod)) {
        if (['default', 'makeTokenStore', 'handleLinkModal', 'handleLinkPromptButton', 'runAutoquestForUser', 'cacheGuildInvites', 'handleInviteJoin', 'handleInviteLeave'].includes(key)) continue;
        if (cmd?.data)   client.commands.set(cmd.data.name, cmd);
        if (cmd?.prefix) client.prefixCommands.set(cmd.prefix, cmd);
        if (cmd?.data?.name) client.prefixCommands.set(cmd.data.name, cmd);
    }
}

const eventFiles = readdirSync(join(__dirname, 'events')).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
    const mod   = await import(pathToFileURL(join(__dirname, 'events', file)).href);
    const event = mod.default;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

// Global Crash Handlers
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
});

client.login(TOKEN);
