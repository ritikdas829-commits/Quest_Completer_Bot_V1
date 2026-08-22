import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { checkCommandAccess } from '../handlers/inviteTracker.js';

export default {
    // Slash Command ke liye
    data: new SlashCommandBuilder()
        .setName('queststatus')
        .setDescription('Check your invite progress and quest command access with interactive buttons!'),

    // Prefix Command (.queststatus) ke liye
    prefix: 'queststatus',

    async execute(interactionOrMessage) {
        // Yeh check karega ki user ne Slash command use kiya hai ya Prefix message (.queststatus)
        const isMessage = !interactionOrMessage.isCommand || !interactionOrMessage.isCommand();
        
        const user = isMessage ? interactionOrMessage.author : interactionOrMessage.user;
        const member = interactionOrMessage.member;

        // User ka invite data check karega
        const access = await checkCommandAccess(user, member);

        // V3 Status Embed
        const embed = new EmbedBuilder()
            .setColor(access.allowed ? '#00FFCC' : '#FF3366')
            .setTitle('🛡️ Quest Status & Invite Verification (V3)')
            .setDescription(access.allowed 
                ? `🎉 **Access Granted!** You have completed your requirements and unlocked all quest commands.` 
                : access.message)
            .setTimestamp()
            .setFooter({ text: 'Quest Completer V3 System', iconURL: interactionOrMessage.client.user.displayAvatarURL() });

        // Interactive Buttons
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_status')
                .setLabel('🔄 Refresh Status')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setLabel('🎫 Open Ticket')
                .setStyle(ButtonStyle.Link)
                .setUrl('https://discord.com') // Apne server ka ticket link yahan daalein
        );

        // Message ka reply dena (Prefix ke liye normal, Slash ke liye ephemeral)
        if (isMessage) {
            await interactionOrMessage.reply({ embeds: [embed], components: [row] });
        } else {
            await interactionOrMessage.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
    }
};
