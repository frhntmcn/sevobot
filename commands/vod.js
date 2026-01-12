const { SlashCommandBuilder } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vod')
        .setDescription('Bir yayıncının VOD (geçmiş yayın) indirme ayarını değiştirir.')
        .addSubcommand(sub =>
            sub.setName('kick')
                .setDescription('Kick yayıncısı için VOD ayarı')
                .addStringOption(option =>
                    option.setName('slug')
                        .setDescription('Yayıncı kullanıcı adı (slug)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('durum')
                        .setDescription('VOD indirme durumu')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Aktif (İndir)', value: 'aktif' },
                            { name: 'Pasif (İndirme)', value: 'pasif' }
                        ))
        )
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const identifier = interaction.options.getString('slug');
        const status = interaction.options.getString('durum');
        const enabled = status === 'aktif';
        const platform = subcommand; // 'kick'

        // Check if channel is watched
        const guildData = storage.getGuild(interaction.guildId);
        const isWatched = guildData.watched.some(w => w.platform === platform && w.identifier === identifier);

        if (!isWatched) {
            return interaction.reply({
                content: `⚠️ **${identifier}** izleme listenizde yok. Önce \`/watch ${platform}\` ile ekleyin.`,
                ephemeral: true
            });
        }

        const success = storage.setVodEnabled(interaction.guildId, platform, identifier, enabled);

        if (success) {
            await interaction.reply({
                content: `✅ **${identifier}** (${platform}) için VOD indirme: **${enabled ? 'AÇIK' : 'KAPALI'}**`
            });
        } else {
            await interaction.reply({
                content: `❌ Bir hata oluştu.`,
                ephemeral: true
            });
        }
    },
};
