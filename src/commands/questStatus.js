import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { checkCommandAccess } from '../handlers/inviteTracker.js';

export default {
    data: new SlashCommandBuilder()
        .setName('queststatus')
        .setDescription('Check your invite progress and quest command access with interactive buttons!'),

    async execute(interaction) {
        const user = interaction.user;
        const member = interaction.member;

        // Check access function call karenge
        const access = await checkCommandAccess(user, member);

        // Ek sundar V3 Embed design
        const embed = new EmbedBuilder()
            .setColor(access.allowed ? '#00FFCC' : '#FF3366')
            .setTitle('🛡️ Quest Status & Invite Verification (V3)')
            .setDescription(access.allowed 
                ? `🎉 **Access Granted!** You have completed your requirements and unlocked all quest commands.` 
                : access.message)
            .setTimestamp()
            .setFooter({ text: 'Quest Completer V3 System', iconURL: interaction.client.user.displayAvatarURL() });

        // Interactive Buttons add karenge
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_status')
                .setLabel('🔄 Refresh Status')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setLabel('🎫 Open Ticket')
                .setStyle(ButtonStyle.Link)
                .setUrl('https://discord.com') // Yahan aap apna ticket channel ya support link daal sakte hain
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
};

