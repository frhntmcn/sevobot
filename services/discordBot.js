const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const roleMessages = require('../config/roleMessages');
const { startStreamManager } = require('./streamManager');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Load Commands
client.commands = new Collection();
const commandsPath = path.join(process.cwd(), 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const commandsToRegister = [];

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commandsToRegister.push(command.data.toJSON());
    } else {
        console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Loaded ${client.commands.size} commands.`);

    // Register Slash Commands
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Started refreshing application (/) commands.');
        // Use applicationCommands (Global) - takes time to update but easier for general use
        // Or Message user to use specific guild ID for dev?
        // Using global for now as it's cleaner.
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commandsToRegister },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }

    // Start Stream Monitor
    startStreamManager(client);
});

// Interaction Handler
client.on('interactionCreate', async interaction => {
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
    if (message.content === '!ping') {
        await message.reply('Pong! (Legacy command)');
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
