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
        const selectedRole = interaction.options.getRole('target');
        const guildId = interaction.guild.id;

        const configPath = path.resolve('./config.json');
        
        let config = {};
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }

        if (!config[guildId]) config[guildId] = {};
        config[guildId].questRoleId = selectedRole.id;

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        const embed = new EmbedBuilder()
            .setColor('#10b981')
            .setTitle('Quest Role Updated')
            .setDescription(`✅ Successfully set the quest access role to **${selectedRole.name}**!`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

