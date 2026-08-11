import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';

export default {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Configure the quest access role for your server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the role that grants quest access')
                .addRoleOption(option =>
                    option.setName('target')
                        .setDescription('Select the role for quest access')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        try {
            const selectedRole = interaction.options.getRole('target');
            const guildId = interaction.guild.id;

            if (!selectedRole) {
                return await interaction.reply({ content: '❌ Please select a valid role!', ephemeral: true });
            }

            const configPath = path.resolve('./config.json');
            let config = {};

            if (fs.existsSync(configPath)) {
                try {
                    const data = fs.readFileSync(configPath, 'utf8');
                    config = JSON.parse(data);
                } catch (err) {
                    config = {};
                }
            }

            if (!config[guildId]) {
                config[guildId] = {};
            }

            // Save role ID correctly as a string
            config[guildId].questRoleId = selectedRole.id;
            config[guildId].questRoleName = selectedRole.name;

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('Quest Role Updated')
                .setDescription(`✅ Successfully set the quest access role to **${selectedRole.name}**!`)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Role set error:', error);
            await interaction.reply({ content: '❌ Kuch gadbad ho gayi, console logs check karein.', ephemeral: true });
        }
    }
};
