const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notify-channel')
        .setDescription('Bu sunucu için bildirim kanalını ayarlar.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Bildirimlerin gideceği kanal (DM için boş bırakın)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('everyone')
                .setDescription('@everyone etiketi atılsın mı?')
                .setRequired(false))
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        let channelId = null;
        let mentionEveryone = false;
        const isDM = !interaction.guildId;

        if (!isDM) {
            const channel = interaction.options.getChannel('channel');
            mentionEveryone = interaction.options.getBoolean('everyone') || false;

            if (!channel.isTextBased()) {
                return interaction.reply({ content: 'Lütfen bir metin kanalı seçin.', ephemeral: true });
            }
            channelId = channel.id;
        } else {
            // For DMs, user ID is the channel
            channelId = interaction.user.id;
        }

        const guildId = isDM ? interaction.user.id : interaction.guildId;
        const guild = storage.getGuild(guildId);
        guild.notifyChannelId = channelId;
        guild.mentionsEnabled = mentionEveryone;
        storage.save();

        if (isDM) {
            await interaction.reply({
                content: `✅ Bildirimler artık bu özel mesaja (DM) gönderilecek.`
            });
        } else {
            await interaction.reply({
                content: `✅ Bildirim kanalı <#${channelId}> olarak ayarlandı.\n📢 @everyone etiketi: **${mentionEveryone ? 'AÇIK' : 'KAPALI'}**`
            });
        }
    },
};
