const { Client, GatewayIntentBits } = require('discord.js');
const roleMessages = require('../config/roleMessages');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
    ],
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Get the roles that were added
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;

        // Filter for roles that are in newMember but not in oldMember
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));

        if (addedRoles.size === 0) return;

        addedRoles.forEach(async (role) => {
            const messageTemplate = roleMessages[role.name];

            if (messageTemplate) {
                try {
                    // Replace {user} with the username or mention if needed. 
                    // For DMs, a direct address is usually nice.
                    const message = messageTemplate.replace('{user}', newMember.user.username);

                    await newMember.user.send(message);
                    console.log(`Sent DM to ${newMember.user.tag} for role ${role.name}`);
                } catch (error) {
                    console.error(`Could not send DM to ${newMember.user.tag}. They might have DMs disabled.`, error);
                }
            }
        });

    } catch (error) {
        console.error('Error in guildMemberUpdate listener:', error);
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
