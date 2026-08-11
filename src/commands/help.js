import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { PREFIX } from '../utils/config.js';

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('See all available commands'),
    prefix: ['help', 'h'],

    async execute(interaction) {
        await sendHelpMessage(interaction);
    },

    async prefixExecute(message, _a, client) {
        await sendHelpMessage(message);
    },
};

async function sendHelpMessage(context) {
    const user = context.author || context.user;
    const client = context.client;

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🤖 Quest Bot Help Menu')
        .setDescription(`Hey **${user.username}**, here's everything I can do:`)
        .addFields(
            {
                name: '🔗 Token',
                value: `\`/link\`  \`${PREFIX}link\` — Link your Discord user token\n\`/unlink\`  \`${PREFIX}unlink\` — Remove your saved token\n\`/tokencheck\`  \`${PREFIX}tokencheck\` — Check if your token is still valid`,
                inline: false
            },
            {
                name: '🎮 Quests',
                value: `\`/quest\`  \`${PREFIX}quest\` — Pick and complete one quest\n\`/questall\`  \`${PREFIX}questall\` — Complete all quests at once\n\`/questlist\`  \`${PREFIX}questlist\` — View all your quests & status\n\`/autoquest\`  \`${PREFIX}autoquest\` — Auto-complete new quests as they drop`,
                inline: false
            },
            {
                name: '📊 Invite System',
                value: `\`/invite\`  \`${PREFIX}invite\`  \`${PREFIX}i\` — Check your invite log and statistics\n\`/resetinvite\` — Reset a user's invite count (Admin Only)`,
                inline: false
            },
            {
                name: '🛠️ Utility',
                value: `\`/ping\`  \`${PREFIX}ping\` — Check bot latency\n\`/help\`  \`${PREFIX}help\` — You're already here`,
                inline: false
            }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: `Serving ${client.guilds.cache.size} server(s) · Prefix: ${PREFIX}` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Join Support Server')
            .setStyle(ButtonStyle.Link)
            .setUrl('https://discord.gg/PFjuWa9zQH')
    );

    if (context.reply) {
        await context.reply({ embeds: [embed], components: [row] });
    } else {
        await context.reply({ embeds: [embed], components: [row] });
    }
}
