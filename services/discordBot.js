const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const roleMessages = require('../config/roleMessages');
const { startStreamManager } = require('./streamManager');
const { handlePlayCommand, handleStopCommand, handleSkipCommand, handleQueueCommand } = require('./musicPlayer');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Load Commands
client.commands = new Collection();
// Load Commands Statically (Required for Vercel/Webpack)
const commands = [
    require('../commands/notify-channel.js'),
    require('../commands/notify-test.js'),
    require('../commands/unwatch.js'),
    require('../commands/watch.js'),
    require('../commands/watchlist.js'),
    require('../commands/vod.js')
];

const commandsToRegister = [];

for (const command of commands) {
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commandsToRegister.push(command.data.toJSON());
        console.log(`[SUCCESS] Loaded command: ${command.data.name}`);
    } else {
        console.warn(`[WARNING] A command is missing a required "data" or "execute" property.`);
    }
}
console.log("Commands to Register:", commandsToRegister.map(c => c.name));

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Loaded ${client.commands.size} commands.`);

    // Register Slash Commands
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Started refreshing application (/) commands.');

        // 1. DELETE Global Commands (Cleanup ghost commands)
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log('Successfully deleted all Global commands.');

        // 2. Register global commands
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commandsToRegister },
        );
        console.log('Successfully registered all Global commands.');

    } catch (error) {
        console.error('Error registering commands:', error);
    }

    // Start Stream Monitor
    startStreamManager(client);
});

// Interaction Handler
client.on('interactionCreate', async interaction => {
    console.log(`Interaction received: ${interaction.commandName} (Type: ${interaction.type})`);
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

// Legacy Role Logic
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // ... existing logic ...
    try {
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        if (addedRoles.size === 0) return;

        addedRoles.forEach(async (role) => {
            let messageTemplate = roleMessages[role.name] || roleMessages[role.name.trim()];
            if (messageTemplate) {
                try {
                    await newMember.user.send(messageTemplate.replace('{user}', newMember.user.username));
                    console.log(`Sent DM to ${newMember.user.tag}`);
                } catch (error) {
                    console.error(`Could not send DM to ${newMember.user.tag}`, error);
                }
            }
        });
    } catch (error) { console.error(error); }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!ping') {
        await message.reply('Pong! (Legacy command)');
    }

    // Music Commands
    if (message.content.startsWith('!play ')) {
        await handlePlayCommand(message);
    } else if (message.content === '!stop') {
        await handleStopCommand(message);
    } else if (message.content === '!skip' || message.content === '!next') {
        await handleSkipCommand(message);
    } else if (message.content === '!queue') {
        await handleQueueCommand(message);
    }
});

const startDiscordBot = (token) => {
    if (!token) {
        console.error('Discord Token is missing!');
        return;
    }
    client.login(token);
};

const getAuthenticatedClient = async () => {
    if (!client.isReady()) {
        console.log("Client not ready, logging in...");
        await client.login(process.env.DISCORD_TOKEN);
        // Wait for ready
        await new Promise(resolve => client.once('clientReady', resolve));
    }
    return client;
};

module.exports = { startDiscordBot, getAuthenticatedClient, client };
