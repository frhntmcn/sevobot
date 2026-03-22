const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notify-test')
        .setDescription('Bildirim ayarlarını test eder.')
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const isDM = !interaction.guildId;
        const guildId = isDM ? interaction.user.id : interaction.guildId;
        const guild = storage.getGuild(guildId);

        if (!guild.notifyChannelId) {
            return interaction.reply({ content: '⚠️ Önce /notify-channel ile bir kanal ayarlamalısınız.', ephemeral: true });
        }

        let targetChannel;
        let mentionStatus = 'KAPALI';
        let warning = '';

        if (isDM) {
            targetChannel = interaction.user;
            mentionStatus = 'DM (Etiket yok)';
        } else {
            targetChannel = interaction.guild.channels.cache.get(guild.notifyChannelId);
            if (!targetChannel) {
                return interaction.reply({ content: '⚠️ Ayarlanan kanal bulunamadı. Lütfen tekrar ayarlayın.', ephemeral: true });
            }

            // Permission Check
            const permissions = targetChannel.permissionsFor(interaction.guild.members.me);
            if (!permissions.has('SendMessages')) {
                return interaction.reply({ content: `⚠️ **${targetChannel.name}** kanalına mesaj gönderme iznim yok!`, ephemeral: true });
            }

            mentionStatus = guild.mentionsEnabled ? 'AÇIK (Everyone etiketi atılacak)' : 'KAPALI';

            if (guild.mentionsEnabled && !permissions.has('MentionEveryone')) {
                warning = '\n⚠️ **UYARI:** Everyone etiketini açtınız ancak **Mention Everyone** iznim yok! Etiket çalışmayacak.';
            }
        }

        await interaction.reply({ content: `Test mesajı gönderiliyor... Hedef: ${isDM ? 'DM' : targetChannel}, Mention: ${mentionStatus}${warning}`, ephemeral: true });

        // Send Test Message
        const testContent = `${(!isDM && guild.mentionsEnabled) ? '@everyone' : ''} 🧪 **Bu bir test bildirimidir!**\nSistem başarıyla kuruldu.`;

        try {
            await targetChannel.send({
                content: testContent,
                allowedMentions: { parse: (!isDM && guild.mentionsEnabled) ? ['everyone'] : [] }
            });
        } catch (error) {
            await interaction.followUp({ content: `❌ Mesaj gönderilirken hata oluştu: ${error.message}`, ephemeral: true });
        }
    },
};
