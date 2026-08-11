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
    
    prefix: 'invite',

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
        const invites = await guild.invites.fetch();
        let totalUses = 0;

        invites.forEach(invite => {
            if (invite.inviter && invite.inviter.id === targetUser.id) {
                totalUses += invite.uses;
            }
        });

        // Embed design jo screenshot jaisa dikhega
        const embed = new EmbedBuilder()
            .setColor('#10b981') // Green/Teal accent color
            .setTitle('Invite log')
            .setDescription(`» **${targetUser.username}** has **${totalUses}** invites`)
            .addFields(
                { name: 'Joins', value: `${totalUses}`, inline: false },
                { name: 'Left', value: '0', inline: false },
                { name: 'Fake', value: '0', inline: false },
                { name: 'Rejoins (7d)', value: '0', inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

        if (context.reply) {
            await context.reply({ embeds: [embed] });
        } else {
            await context.reply({ embeds: [embed] });
        }
    } catch (err) {
        console.error("Error generating invite embed:", err);
        const errorMsg = '❌ Could not fetch invite statistics.';
        if (context.reply) {
            await context.reply({ content: errorMsg, ephemeral: true });
        } else {
            await context.reply(errorMsg);
        }
    }
}
