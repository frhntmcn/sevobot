const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notify-channel')
        .setDescription('Bu sunucu için bildirim kanalını ayarlar.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Bildirimlerin gideceği kanal')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('everyone')
                .setDescription('@everyone etiketi atılsın mı?')
                .setRequired(false))
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        const mentionEveryone = interaction.options.getBoolean('everyone') || false;

        // Validasyon
        if (!channel.isTextBased()) {
            return interaction.reply({ content: 'Lütfen bir metin kanalı seçin.', ephemeral: true });
        }

        const guild = storage.getGuild(interaction.guildId);
        guild.notifyChannelId = channel.id;
        guild.mentionsEnabled = mentionEveryone;
        storage.save();

        await interaction.reply({
            content: `✅ Bildirim kanalı ${channel} olarak ayarlandı.\n📢 @everyone etiketi: **${mentionEveryone ? 'AÇIK' : 'KAPALI'}**`
        });
    },
};
