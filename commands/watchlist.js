const { SlashCommandBuilder } = require('discord.js');
const storage = require('../services/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('watchlist')
        .setDescription('İzlenen yayıncıları listeler.'),

    async execute(interaction) {
        const guildId = interaction.guildId || interaction.user.id;
        const watched = storage.getWatchList(guildId);

        if (!watched || watched.length === 0) {
            return interaction.reply('📭 İzleme listeniz boş.');
        }

        const twitchList = watched.filter(w => w.platform === 'twitch').map(w => `• ${w.identifier}`).join('\n');
        const kickList = watched.filter(w => w.platform === 'kick').map(w => `• ${w.identifier}`).join('\n');

        let msg = '**📋 İzleme Listesi**\n\n';
        if (twitchList) msg += `**Twitch:**\n${twitchList}\n\n`;
        if (kickList) msg += `**Kick:**\n${kickList}`;

        if (!twitchList && !kickList) {
            msg += 'Liste boş.';
        }

        await interaction.reply(msg);
    },
};
