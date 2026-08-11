import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

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

    async prefixExecute(message, args, client) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('❌ Please mention a valid user to reset invites for. Example: `.reset invite @username`');
        }

        await handleReset(message, targetUser);
    },

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('target');
        await handleReset(interaction, targetUser);
    }
};

async function handleReset(context, targetUser) {
    // Yahan aap apna reset logic likh sakte hain (jaise invite count ko 0 set karna)
    
    const embed = new EmbedBuilder()
        .setColor('#ef4444') // Red accent for reset action
        .setTitle('Invite Reset')
        .setDescription(`✅ Successfully reset the invite count for **${targetUser.username}** to **0**.`)
        .setTimestamp();

    if (context.reply) {
        await context.reply({ embeds: [embed], ephemeral: true });
    } else {
        await context.reply({ embeds: [embed] });
    }
}
