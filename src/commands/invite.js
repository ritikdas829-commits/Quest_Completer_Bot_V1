import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Check your invite log and statistics')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('Optional: Check another user\'s invites')
                .setRequired(false)
        ),
    
    prefix: 'i',

    async prefixExecute(message, args, client) {
        let targetUser = message.author;
        if (args && args[0]) {
            const mention = message.mentions.users.first();
            if (mention) targetUser = mention;
        }
        await sendInviteEmbed(message, targetUser);
    },

    async execute(interaction) {
        let targetUser = interaction.options.getUser('target') || interaction.user;
        await sendInviteEmbed(interaction, targetUser);
    }
};

async function sendInviteEmbed(context, targetUser) {
    try {
        const guild = context.guild;
        
        // Fetch invites safely with permissions check
        let totalUses = 0;
        try {
            const invites = await guild.invites.fetch();
            invites.forEach(invite => {
                if (invite.inviter && invite.inviter.id === targetUser.id) {
                    totalUses += invite.uses;
                }
            });
        } catch (e) {
            console.log("Could not fetch invites, bot might lack Manage Guild permission.");
        }

        const embed = new EmbedBuilder()
            .setColor('#10b981')
            .setTitle('Invite log')
            .setDescription(`» **${targetUser.username}** has **${totalUses}** invites`)
            .addFields(
                { name: 'Joins', value: `${totalUses}`, inline: false },
                { name: 'Left', value: '0', inline: false },
                { name: 'Fake', value: '0', inline: false },
                { name: 'Rejoins (7d)', value: '0', inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

        // Send response safely handling both interactions and prefix messages
        if (context.isCommand && context.isCommand()) {
            if (context.replied || context.deferred) {
                await context.editReply({ embeds: [embed] });
            } else {
                await context.reply({ embeds: [embed] });
            }
        } else {
            await context.reply({ embeds: [embed] });
        }
    } catch (err) {
        console.error("Error generating invite embed:", err);
        const errorMsg = '❌ Could not fetch invite statistics.';
        try {
            if (context.replied || context.deferred) {
                await context.editReply({ content: errorMsg });
            } else {
                await context.reply({ content: errorMsg });
            }
        } catch (e) {
            // Fallback if message reply fails
        }
    }
}
