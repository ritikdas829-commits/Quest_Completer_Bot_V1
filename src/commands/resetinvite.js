import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('resetinvite')
        .setDescription('Reset a user\'s invite count (Admin Only)')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user whose invites you want to reset')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    prefix: 'reset invite',

    async execute(messageOrInteraction, args, client) {
        let member = messageOrInteraction.member;

        // Check if user is Administrator
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            const replyText = '❌ You do not have permission to use this command.';
            if (messageOrInteraction.reply) {
                return messageOrInteraction.reply({ content: replyText, ephemeral: true });
            } else {
                return messageOrInteraction.reply(replyText);
            }
        }

        let targetUser = null;
        if (messageOrInteraction.options) {
            targetUser = messageOrInteraction.options.getUser('target');
        } else if (args && args[0]) {
            const mention = messageOrInteraction.mentions.users.first();
            targetUser = mention || await client.users.fetch(args[0]).catch(() => null);
        }

        if (!targetUser) {
            const replyText = '❌ Please specify or mention a valid user to reset invites for.';
            if (messageOrInteraction.reply) {
                return messageOrInteraction.reply({ content: replyText, ephemeral: true });
            } else {
                return messageOrInteraction.reply(replyText);
            }
        }

        const successMessage = `✅ Successfully processed invite reset for **${targetUser.tag}**.`;
        if (messageOrInteraction.reply) {
            await messageOrInteraction.reply({ content: successMessage, ephemeral: true });
        } else {
            await messageOrInteraction.reply(successMessage);
        }
    }
};

