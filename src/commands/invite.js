import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Check your invite count or manage invites')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('Optional: Check another user\'s invites')
                .setRequired(false)
        ),
    
    prefix: 'invite',

    async execute(messageOrInteraction, args, client) {
        let targetUser = messageOrInteraction.author || messageOrInteraction.user;

        if (messageOrInteraction.options) {
            const optionUser = messageOrInteraction.options.getUser('target');
            if (optionUser) targetUser = optionUser;
        } else if (args && args[0]) {
            const mention = messageOrInteraction.mentions.users.first();
            if (mention) targetUser = mention;
        }

        try {
            const guild = messageOrInteraction.guild;
            const invites = await guild.invites.fetch();
            let totalUses = 0;

            invites.forEach(invite => {
                if (invite.inviter && invite.inviter.id === targetUser.id) {
                    totalUses += invite.uses;
                }
            });

            const responseText = `📊 **${targetUser.tag}** has completed **${totalUses}** valid invite(s) in this server.`;

            if (messageOrInteraction.reply) {
                await messageOrInteraction.reply({ content: responseText, ephemeral: false });
            } else {
                await messageOrInteraction.reply(responseText);
            }
        } catch (err) {
            console.error("Error fetching invites:", err);
            const errorText = '❌ Could not fetch invite information for this user.';
            if (messageOrInteraction.reply) {
                await messageOrInteraction.reply({ content: errorText, ephemeral: true });
            } else {
                await messageOrInteraction.reply(errorText);
            }
        }
    }
};
