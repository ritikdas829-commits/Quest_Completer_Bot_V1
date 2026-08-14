import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { PREFIX } from '../utils/config.js';

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('See all available commands'),
    prefix: 'help',

    async execute(interaction) {
        await interaction.reply(buildHelp(interaction.user, interaction.client));
    },

    async prefixExecute(message, _a, client) {
        await message.reply(buildHelp(message.author, client));
    },
};

function buildHelp(user, client) {
    const avatar = user.displayAvatarURL({ size: 128, extension: 'png' });
    const botAvatar = client.user.displayAvatarURL({ size: 128, extension: 'png' });

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🤖 Quest Bot')
        .setDescription(`Hey **${user.username}**, here's everything I can do`)
        .setThumbnail(botAvatar)
        .addFields(
            {
                name: '🔗 Token',
                value: `\`/link\`  \`${PREFIX}link\` — Link your Discord user token\n\`/unlink\`  \`${PREFIX}unlink\` — Remove your saved token\n\`/tokencheck\`  \`${PREFIX}tokencheck\` — Check if your token is still valid`,
                inline: false
            },
            {
                name: '🎮 Quests',
                value: `\`/quest\`  \`${PREFIX}quest\` — Pick and complete one quest\n\`/q\`  \`${PREFIX}q\` — Complete all quests at once\n\`/questlist\`  \`${PREFIX}questlist\` — View all your quests & status\n\`/autoquest\`  \`${PREFIX}autoquest\` — Auto-complete new quests as they drop`,
                inline: false
            },
            {
                name: '🛠️ Utility',
                value: `\`/ping\`  \`${PREFIX}ping\` — Check bot latency\n\`/help\`  \`${PREFIX}help\` — You're already here`,
                inline: false
            }
        )
        .setFooter({ text: `Serving ${client.guilds.cache.size} server(s)  ·  Prefix: ${PREFIX}`, iconURL: avatar })
        .setTimestamp();

    const button = new ButtonBuilder()
        .setLabel('Support Server')
        .setStyle(ButtonStyle.Link)
        .setUrl('https://discord.gg/eWEApjF7AY');

    const row = new ActionRowBuilder().addComponents(button);

    return { embeds: [embed], components: [row] };
}
