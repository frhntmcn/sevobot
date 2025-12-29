const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('watch')
        .setDescription('Bir yayıncıyı izleme listesine ekler.')
        .addSubcommand(sub =>
            sub.setName('twitch')
                .setDescription('Twitch yayıncısı ekle')
                .addStringOption(option => option.setName('username').setDescription('Twitch kullanıcı adı').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('kick')
                .setDescription('Kick yayıncısı ekle')
                .addStringOption(option => option.setName('slug').setDescription('Kick kullanıcı adı (slug)').setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const identifier = interaction.options.getString(subcommand === 'twitch' ? 'username' : 'slug');
        const platform = subcommand;

        const added = storage.addWatch(interaction.guildId, platform, identifier);

        if (added) {
            await interaction.reply(`✅ **${identifier}** (${platform}) izleme listesine eklendi.`);
        } else {
            await interaction.reply({ content: `⚠️ **${identifier}** zaten listede ekli.`, ephemeral: true });
        }
    },
};
