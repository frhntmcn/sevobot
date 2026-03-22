const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unwatch')
        .setDescription('Bir yayıncıyı izleme listesinden çıkarır.')
        .addStringOption(option =>
            option.setName('platform')
                .setDescription('Platform')
                .setRequired(true)
                .addChoices(
                    { name: 'Twitch', value: 'twitch' },
                    { name: 'Kick', value: 'kick' }
                ))
        .addStringOption(option =>
            option.setName('identifier')
                .setDescription('Kullanıcı adı')
                .setRequired(true))
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const platform = interaction.options.getString('platform');
        const identifier = interaction.options.getString('identifier');

        const guildId = interaction.guildId || interaction.user.id;
        const removed = storage.removeWatch(guildId, platform, identifier);

        if (removed) {
            await interaction.reply(`🗑️ **${identifier}** (${platform}) listeden silindi.`);
        } else {
            await interaction.reply({ content: `⚠️ Bu yayıncı listenizde bulunamadı.`, ephemeral: true });
        }
    },
};
