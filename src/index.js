import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials, EmbedBuilder, ActivityType } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import deployCommands from './utils/deployCommands.js';
import { makeTokenStore, handlePlatformButton } from './commands/questCommands.js';
import { writeFileSync, existsSync } from 'fs';
import { cacheGuildInvites, handleInviteJoin, handleInviteLeave, checkCommandAccess } from './handlers/inviteTracker.js';

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
        `  ${col.green}●${col.reset} ${col.white}Quest Completer V3${col.reset}  ${col.dim}|${col.reset}   ${col.white}dsc.gg/synoraxdev${col.reset}`,
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
await deployCommands(TOKEN, process.env.DISCORD_CLIENT_ID);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel],
});

client.commands       = new Collection();
client.prefixCommands = new Collection();
client.tokenStore     = makeTokenStore(TOKEN);

global.AUTO_ROLE_ID = null;

client.once('clientReady', async () => {
    await cacheGuildInvites(client);

    client.user.setActivity('Quest Completer V3 | .help', { type: ActivityType.Watching });
    
    client.guilds.cache.forEach(async (guild) => {
        try {
            let role = guild.roles.cache.find(r => r.name === 'Quest Access');
            if (!role) {
                role = await guild.roles.create({
                    name: 'Quest Access',
                    color: 'Blue',
                    reason: 'Automatic role created by Quest Completer Bot for invite verification',
                });
                console.log(`[Auto-Role] Created 'Quest Access' role in guild: ${guild.name}`);
            }
            global.AUTO_ROLE_ID = role.id;
        } catch (err) {
            console.error(`Failed to create auto-role in guild ${guild.name}:`, err);
        }
    });

    console.log('Invite tracker and Auto-Role system successfully initialized!');
});

client.on('guildMemberAdd', (member) => {
    handleInviteJoin(member);
});

client.on('guildMemberRemove', (member) => {
    handleInviteLeave(member);
});

// Safe & Smart Prefix Message Handler
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = '.'; 
    
    if (message.content.startsWith(prefix)) {
        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = client.prefixCommands.get(commandName) || client.commands.get(commandName);
        if (command) {
            try {
                if (typeof command.prefixExecute === 'function') {
                    await command.prefixExecute(message, args, client);
                } else if (typeof command.execute === 'function') {
                    // Safe execution wrapper for slash-based commands used via prefix
                    await command.execute(message, client);
                }
            } catch (error) {
                console.error(`Error executing prefix command ${commandName}:`, error);
                await message.reply('There was an error executing that command!').catch(() => {});
            }
            return;
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        if (interaction.customId === 'refresh_status') {
            const access = await checkCommandAccess(interaction.user, interaction.member);
            
            const updatedEmbed = new EmbedBuilder()
                .setColor(access.allowed ? '#00FFCC' : '#FF3366')
                .setTitle('🛡️ Quest Status & Invite Verification (V3)')
                .setDescription(access.allowed 
                    ? `🎉 **Access Granted!** Status refreshed successfully.` 
                    : access.message)
                .setTimestamp()
                .setFooter({ text: 'Quest Completer V3 System', iconURL: interaction.client.user.displayAvatarURL() });

            await interaction.update({ embeds: [updatedEmbed] }).catch(() => {});
        } 
        else if (interaction.customId === 'btn_pc' || interaction.customId === 'btn_android' || interaction.customId === 'btn_ios') {
            await handlePlatformButton(interaction);
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true }).catch(() => {});
        }
    }
});

// Auto-register all commands as both slash and prefix commands
const commandFiles = readdirSync(join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const mod = await import(pathToFileURL(join(__dirname, 'commands', file)).href);
    
    if (mod.default) {
        const cmd = mod.default;
        if (cmd?.data?.name) {
            client.commands.set(cmd.data.name, cmd);
            client.prefixCommands.set(cmd.data.name, cmd); // Ensures .q, .link, etc. all work
        }
        if (cmd?.prefix) {
            client.prefixCommands.set(cmd.prefix, cmd);
        }
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
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception thrown:', error);
});

client.login(TOKEN);
