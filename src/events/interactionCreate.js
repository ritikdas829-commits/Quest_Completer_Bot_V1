import {
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
} from 'discord.js';

import { getEmoji } from '../handlers/emoji.js';
import {
    handleLinkModal,
    handleLinkPromptButton,
} from '../commands/questCommands.js';

import { checkCommandAccess } from '../handlers/inviteTracker.js';

export default {
    name: 'interactionCreate',
    once: false,

    async execute(interaction, client) {

        // =========================================================
        // MODAL: LINK TOKEN
        // =========================================================

        if (
            interaction.isModalSubmit() &&
            interaction.customId === 'link_token_modal'
        ) {
            try {
                await handleLinkModal(interaction, client);
            } catch (error) {
                console.error('[LINK MODAL ERROR]', error);

                await sendInteractionError(
                    interaction,
                    '❌ Failed to process the link request.'
                );
            }

            return;
        }


        // =========================================================
        // BUTTON: LINK PROMPT
        // =========================================================

        if (
            interaction.isButton() &&
            interaction.customId === 'link_prompt'
        ) {
            try {
                await handleLinkPromptButton(interaction);
            } catch (error) {
                console.error('[LINK PROMPT ERROR]', error);

                await sendInteractionError(
                    interaction,
                    '❌ Failed to open the link menu.'
                );
            }

            return;
        }


        // =========================================================
        // BUTTON: PLATFORM PC
        // =========================================================

        if (
            interaction.isButton() &&
            interaction.customId === 'platform_pc'
        ) {
            try {
                await interaction.reply({
                    content:
                        `### 🪄 PC Quest Tutorial\n\n` +
                        `PC par quest complete karne ke liye ye tutorial dekho:\n\n` +
                        `https://cdn.discordapp.com/attachments/1539823157425348758/1540748022399504404/lv_0_20260821085534.mp4\n\n` +
                        `⚠️ Apna Discord password, token ya login information kisi ke saath share mat karo.`,
                    flags: MessageFlags.Ephemeral,
                });
            } catch (error) {
                console.error('[PLATFORM PC ERROR]', error);
            }

            return;
        }


        // =========================================================
        // BUTTON: REFRESH STATUS
        // =========================================================

        if (
            interaction.isButton() &&
            interaction.customId === 'refresh_status'
        ) {
            try {
                const user = interaction.user;
                const member = interaction.member;

                const access = await checkCommandAccess(
                    user,
                    member
                );

                const embed = new EmbedBuilder()
                    .setColor(
                        access.allowed
                            ? '#00FFCC'
                            : '#FF3366'
                    )
                    .setTitle(
                        '🛡️ Quest Status & Invite Verification (V3)'
                    )
                    .setDescription(
                        access.allowed
                            ? `🎉 **Access Granted!**\n\nStatus refreshed successfully.`
                            : access.message
                    )
                    .setTimestamp()
                    .setFooter({
                        text: 'Quest Completer V3 System',
                        iconURL: client.user.displayAvatarURL(),
                    });

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('refresh_status')
                            .setLabel('🔄 Refresh Status')
                            .setStyle(ButtonStyle.Primary),

                        new ButtonBuilder()
                            .setCustomId('create_ticket')
                            .setLabel('🎫 Open Ticket')
                            .setStyle(ButtonStyle.Secondary)
                    );

                await interaction.update({
                    embeds: [embed],
                    components: [row],
                });

            } catch (error) {
                console.error(
                    '[REFRESH STATUS ERROR]',
                    error
                );

                await sendInteractionError(
                    interaction,
                    '❌ Failed to refresh your status.'
                );
            }

            return;
        }


        // =========================================================
        // BUTTON: CREATE TICKET
        // =========================================================

        if (
            interaction.isButton() &&
            interaction.customId === 'create_ticket'
        ) {
            const guild = interaction.guild;
            const member = interaction.member;

            if (!guild || !member) {
                await sendInteractionError(
                    interaction,
                    '❌ This button can only be used inside a server.'
                );

                return;
            }

            try {
                // Safe channel name
                const cleanUsername = member.user.username
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '')
                    .slice(0, 20);

                const channelName =
                    `ticket-${cleanUsername || member.id.slice(-6)}`;


                // -------------------------------------------------
                // Check existing ticket
                // -------------------------------------------------

                const existingTicket =
                    guild.channels.cache.find(
                        channel =>
                            channel.type === ChannelType.GuildText &&
                            channel.name === channelName
                    );

                if (existingTicket) {
                    await interaction.reply({
                        content:
                            `⚠️ You already have an open ticket: ${existingTicket}`,
                        flags: MessageFlags.Ephemeral,
                    });

                    return;
                }


                // -------------------------------------------------
                // Create ticket
                // -------------------------------------------------

                const ticketChannel =
                    await guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildText,

                        permissionOverwrites: [
                            {
                                id: guild.id,

                                deny: [
                                    PermissionFlagsBits.ViewChannel,
                                ],
                            },

                            {
                                id: member.id,

                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.SendMessages,
                                    PermissionFlagsBits.ReadMessageHistory,
                                ],
                            },

                            {
                                id: client.user.id,

                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.SendMessages,
                                    PermissionFlagsBits.ReadMessageHistory,
                                    PermissionFlagsBits.ManageChannels,
                                ],
                            },
                        ],
                    });


                // -------------------------------------------------
                // Reply to user
                // -------------------------------------------------

                await interaction.reply({
                    content:
                        `✅ Your ticket channel has been created successfully: ${ticketChannel}`,
                    flags: MessageFlags.Ephemeral,
                });


                // -------------------------------------------------
                // Close button
                // -------------------------------------------------

                const closeRow =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('close_ticket')
                                .setLabel('🔒 Close Ticket')
                                .setStyle(ButtonStyle.Danger)
                        );


                await ticketChannel.send({
                    content:
                        `Hello ${member}, welcome to your support ticket!\n\n` +
                        `Please describe your issue here and staff will help you soon.`,

                    components: [closeRow],
                });

            } catch (error) {
                console.error(
                    '[TICKET CREATION ERROR]',
                    error
                );

                await sendInteractionError(
                    interaction,
                    '❌ Failed to create a ticket channel. Please contact an admin.'
                );
            }

            return;
        }


        // =========================================================
        // BUTTON: CLOSE TICKET
        // =========================================================

        if (
            interaction.isButton() &&
            interaction.customId === 'close_ticket'
        ) {
            const channel = interaction.channel;

            try {
                await interaction.reply({
                    content:
                        '🔒 Closing this ticket in 3 seconds...',
                    flags: MessageFlags.Ephemeral,
                });

                setTimeout(async () => {
                    try {
                        if (channel) {
                            await channel.delete();
                        }
                    } catch (error) {
                        console.error(
                            '[TICKET DELETE ERROR]',
                            error
                        );
                    }
                }, 3000);

            } catch (error) {
                console.error(
                    '[CLOSE TICKET ERROR]',
                    error
                );
            }

            return;
        }


        // =========================================================
        // SLASH COMMANDS
        // =========================================================

        if (!interaction.isChatInputCommand()) {
            return;
        }


        // Find command
        const command =
            client.commands.get(
                interaction.commandName
            );


        if (!command) {
            console.warn(
                `[COMMAND NOT FOUND] /${interaction.commandName}`
            );

            return;
        }


        // =========================================================
        // EXECUTE COMMAND
        // =========================================================

        try {
            await command.execute(
                interaction,
                client
            );

        } catch (error) {
            console.error(
                `[COMMAND ERROR] /${interaction.commandName}`,
                error
            );


            // -----------------------------------------------------
            // Already replied/deferred
            // -----------------------------------------------------

            if (
                interaction.replied ||
                interaction.deferred
            ) {
                await interaction.followUp({
                    content:
                        `${getEmoji('error')} Something went wrong while executing this command.`,
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});

                return;
            }


            // -----------------------------------------------------
            // Interaction still available
            // -----------------------------------------------------

            await interaction.reply({
                content:
                    `${getEmoji('error')} Something went wrong while executing this command.`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    },
};


// =============================================================
// SAFE INTERACTION ERROR HANDLER
// =============================================================

async function sendInteractionError(
    interaction,
    content
) {
    try {
        // Already replied
        if (interaction.replied) {
            await interaction.followUp({
                content,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});

            return;
        }


        // Already deferred
        if (interaction.deferred) {
            await interaction.editReply({
                content,
            }).catch(() => {});

            return;
        }


        // Normal reply
        await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});

    } catch (error) {
        console.error(
            '[INTERACTION ERROR HANDLER]',
            error
        );
    }
}
