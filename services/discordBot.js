const { Client, GatewayIntentBits } = require('discord.js');
const roleMessages = require('../config/roleMessages');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    console.log(`User update detected for: ${newMember.user.tag}`);

    try {
        // Get the roles that were added
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;

        // Filter for roles that are in newMember but not in oldMember
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));

        if (addedRoles.size === 0) {
            console.log("No new roles detected.");
            return;
        }

        addedRoles.forEach(async (role) => {
            console.log(`Role added: "${role.name}"`);

            // Attempt exact match first
            let messageTemplate = roleMessages[role.name];

            // If no exact match, try trimming whitespace
            if (!messageTemplate) {
                const trimmedName = role.name.trim();
                messageTemplate = roleMessages[trimmedName];
                if (messageTemplate) console.log(`Matched role via trim: "${trimmedName}"`);
            }

            if (messageTemplate) {
                try {
                    const message = messageTemplate.replace('{user}', newMember.user.username);
                    await newMember.user.send(message);
                    console.log(`SUCCESS: Sent DM to ${newMember.user.tag} for role ${role.name}`);
                } catch (error) {
                    console.error(`FAILED: Could not send DM to ${newMember.user.tag}. Check their privacy settings.`, error);
                }
            } else {
                console.log(`No message found for role: "${role.name}". Check config/roleMessages.js for exact match.`);
            }
        });

    } catch (error) {
        console.error('Error in guildMemberUpdate listener:', error);
    }
});

client.on('messageCreate', async (message) => {
    if (message.content === '!ping') {
        console.log(`Ping command received from ${message.author.tag}`);
        await message.reply('Pong! 🏓 (Bot is online and listening)');
    }
});

const startDiscordBot = (token) => {
    if (!token) {
        console.error('Discord Token is missing!');
        return;
    }
    client.login(token);
};

module.exports = { startDiscordBot };
