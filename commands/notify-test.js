const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notify-test')
        .setDescription('Bildirim ayarlarını test eder.')
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const guild = storage.getGuild(interaction.guildId);

        if (!guild.notifyChannelId) {
            return interaction.reply({ content: '⚠️ Önce /notify-channel ile bir kanal ayarlamalısınız.', ephemeral: true });
        }

        const channel = interaction.guild.channels.cache.get(guild.notifyChannelId);
        if (!channel) {
            return interaction.reply({ content: '⚠️ Ayarlanan kanal bulunamadı. Lütfen tekrar ayarlayın.', ephemeral: true });
        }

        // Permission Check
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions.has('SendMessages')) {
            return interaction.reply({ content: `⚠️ **${channel.name}** kanalına mesaj gönderme iznim yok!`, ephemeral: true });
        }

        const mentionStatus = guild.mentionsEnabled ? 'AÇIK (Everyone etiketi atılacak)' : 'KAPALI';
        let warning = '';

        if (guild.mentionsEnabled && !permissions.has('MentionEveryone')) {
            warning = '\n⚠️ **UYARI:** Everyone etiketini açtınız ancak **Mention Everyone** iznim yok! Etiket çalışmayacak.';
        }

        await interaction.reply({ content: `Test mesajı gönderiliyor... Kanal: ${channel}, Mention: ${mentionStatus}${warning}`, ephemeral: true });

        // Send Test Message
        const testContent = `${guild.mentionsEnabled ? '@everyone' : ''} 🧪 **Bu bir test bildirimidir!**\nSistem başarıyla kuruldu.`;

        try {
            await channel.send({
                content: testContent,
                allowedMentions: { parse: guild.mentionsEnabled ? ['everyone'] : [] }
            });
        } catch (error) {
            await interaction.followUp({ content: `❌ Mesaj gönderilirken hata oluştu: ${error.message}`, ephemeral: true });
        }
    },
};
