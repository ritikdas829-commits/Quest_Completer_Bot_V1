import { getEmoji } from '../handlers/emoji.js';
import { handleLinkModal, handleLinkPromptButton } from '../commands/questCommands.js';
import { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { checkCommandAccess } from '../handlers/inviteTracker.js';

export default {
    name: 'interactionCreate',
    once: false,
    async execute(interaction, client) {

        // Modal: link token
        if (interaction.isModalSubmit() && interaction.customId === 'link_token_modal') {
            await handleLinkModal(interaction, client);
            return;
        }

        // Button: link_prompt (opens modal)
        if (interaction.isButton() && interaction.customId === 'link_prompt') {
            await handleLinkPromptButton(interaction);
            return;
        }

        // Button: platform_pc (How to use bot / Tutorial Video Link)
        if (interaction.isButton() && interaction.customId === 'platform_pc') {
            await interaction.reply({
                content: `🎥 **How to use bot:**\nWatch the video tutorial here: https://cdn.discordapp.com/attachments/1539823157425348758/1540748022399504404/lv_0_20260821085534.mp4`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
import { getEmoji } from '../handlers/emoji.js';
import { handleLinkModal, handleLinkPromptButton } from '../commands/questCommands.js';
import { MessageFlags } from 'discord.js';

export default {
    name: 'interactionCreate',
    once: false,
    async execute(interaction, client) {

        // Modal: link token
        if (interaction.isModalSubmit() && interaction.customId === 'link_token_modal') {
            await handleLinkModal(interaction, client);
            return;
        }

        // Button: link_prompt (opens modal)
        if (interaction.isButton() && interaction.customId === 'link_prompt') {
            await handleLinkPromptButton(interaction);
            return;
        }

        // Button: platform_pc (JavaScript script button)
        if (interaction.isButton() && interaction.customId === 'platform_pc') {
            await interaction.reply({
                content: `### 🪄 Token Copy Script\nLong press or use the copy button to copy the code below:\n\n\`\njavascript:(function(){try{let f=document.createElement('iframe');document.body.appendChild(f);let t=JSON.parse(f.contentWindow.localStorage.token);let ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();let n=document.createElement('div');n.innerHTML='<strong>Token Copied</strong><br>Your token has been copied to clipboard';n.style.cssText='position:fixed;top:20px;left:20px;background:#001f3f;color:#7FDBFF;padding:12px%2016px;border-radius:8px;box-shadow:0%204px%2012px%20rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,Segoe%20UI,Roboto,sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity%200.3s%20ease-in-out;';document.body.appendChild(n);setTimeout(()=%3E{n.style.opacity='1';},50);setTimeout(()=%3E{n.style.opacity='0';setTimeout(()=%3En.remove(),500);},3500);}catch(e){alert('Error%20copying%20token');}})();\n\``,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        // Slash commands
        if (!interaction.isChatInputCommand()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (err) {
            console.error(err);
            const msg = { content: `${getEmoji('error')} Something went wrong.`, flags: 64 };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(msg).catch(() => {});
            } else {
                await interaction.reply(msg).catch(() => {});
            }
        }
    },
};
        // ==========================================
        // [yeh copy kar ke video ka tutorial dekhe]
        // ==========================================

        // 1. Refresh Status Button Handler
        if (interaction.isButton() && interaction.customId === 'refresh_status') {
            const user = interaction.user;
            const member = interaction.member;

            const access = await checkCommandAccess(user, member);

            const embed = new EmbedBuilder()
                .setColor(access.allowed ? '#00FFCC' : '#FF3366')
                .setTitle('🛡️ Quest Status & Invite Verification (V3)')
                .setDescription(access.allowed 
                    ? `🎉 **Access Granted!** Status refreshed successfully.` 
                    : access.message)
                .setTimestamp()
                .setFooter({ text: 'Quest Completer V3 System', iconURL: client.user.displayAvatarURL() });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_status')
                    .setLabel('🔄 Refresh Status')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('🎫 Open Ticket')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
            return;
        }

        // 2. Open Ticket Button Handler (Creates a private channel with Close button)
        if (interaction.isButton() && interaction.customId === 'create_ticket') {
            const guild = interaction.guild;
            const member = interaction.member;

            try {
                const channelName = `ticket-${member.user.username}`.toLowerCase().replace(/[^a-z0-9]/g, '');
                
                const ticketChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: member.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                        },
                        {
                            id: client.user.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
                        }
                    ],
                });

                await interaction.reply({ 
                    content: `✅ Your ticket channel has been created successfully: ${ticketChannel}`, 
                    flags: MessageFlags.Ephemeral 
                });

                // Close ticket button row
                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('🔒 Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({
                    content: `Hello ${member}, welcome to your support ticket! Describe your issue here and staff will help you soon.`,
                    components: [closeRow]
                });

            } catch (err) {
                console.error("Ticket creation error:", err);
                await interaction.reply({ 
                    content: `❌ Failed to create a ticket channel. Please contact an admin.`, 
                    flags: MessageFlags.Ephemeral 
                });
            }
            return;
        }

        // 3. Close Ticket Button Handler (Deletes the channel)
        if (interaction.isButton() && interaction.customId === 'close_ticket') {
            const channel = interaction.channel;
            
            await interaction.reply({ 
                content: `🔒 Closing this ticket in 3 seconds...`, 
                flags: MessageFlags.Ephemeral 
            });
            
            setTimeout(async () => {
                try {
                    await channel.delete();
                } catch (err) {
                    console.error("Failed to delete channel:", err);
                }
            }, 3000);
            return;
        }

        // Slash commands
        if (!interaction.isChatInputCommand()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (err) {
            console.error(err);
            const msg = { content: `${getEmoji('error')} Something went wrong.`, flags: 64 };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(msg).catch(() => {});
            } else {
                await interaction.reply(msg).catch(() => {});
            }
        }
    },
};
