import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { checkCommandAccess } from '../handlers/inviteTracker.js';

export default {
    data: new SlashCommandBuilder()
        .setName('queststatus')
        .setDescription('Check your invite progress and quest command access with interactive buttons!'),

    prefix: 'queststatus',

    async execute(interaction, client) {
        const user = interaction.user;
        const member = interaction.member;

        const access = await checkCommandAccess(user, member);

        const embed = new EmbedBuilder()
            .setColor(access.allowed ? '#00FFCC' : '#FF3366')
            .setTitle('🛡️ Quest Status & Invite Verification (V3)')
            .setDescription(access.allowed 
                ? `🎉 **Access Granted!** You have completed your requirements and unlocked all quest commands.` 
                : access.message)
            .setTimestamp()
            .setFooter({ text: 'Quest Completer V3 System', iconURL: client.user.displayAvatarURL() });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_status')
                .setLabel('🔄 Refresh Status')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setLabel('🎫 Open Ticket')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.com') // Yahan URL capital hona chahiye
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    },

    async prefixExecute(message, _args, client) {
        const user = message.author;
        const member = message.member;

        const access = await checkCommandAccess(user, member);

        const embed = new EmbedBuilder()
            .setColor(access.allowed ? '#00FFCC' : '#FF3366')
            .setTitle('🛡️ Quest Status & Invite Verification (V3)')
            .setDescription(access.allowed 
                ? `🎉 **Access Granted!** You have completed your requirements and unlocked all quest commands.` 
                : access.message)
            .setTimestamp()
            .setFooter({ text: 'Quest Completer V3 System', iconURL: client.user.displayAvatarURL() });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_status')
                .setLabel('🔄 Refresh Status')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setLabel('🎫 Open Ticket')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.com') // Yahan bhi URL capital hona chahiye
        );

        await message.reply({ embeds: [embed], components: [row] });
    }
};
