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
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const identifier = interaction.options.getString(subcommand === 'twitch' ? 'username' : 'slug');
        const platform = subcommand;

        const added = storage.addWatch(interaction.guildId, platform, identifier);

        if (added) {
            let msg = `✅ **${identifier}** (${platform}) izleme listesine eklendi.`;

            // Check if notify channel is set
            const guild = storage.getGuild(interaction.guildId);
            if (!guild.notifyChannelId) {
                msg += `\n\n⚠️ **Dikkat:** Henüz bildirim kanalı ayarlamadınız! Bot bildirim gönderemez.\nLütfen \`/notify-channel\` komutunu kullanarak bir kanal seçin.`;
            }

            await interaction.reply(msg);
        } else {
            await interaction.reply({ content: `⚠️ **${identifier}** zaten listede ekli.`, ephemeral: true });
        }
    },
};
