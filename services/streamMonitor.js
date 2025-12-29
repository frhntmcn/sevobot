// services/streamMonitor.js
const streamerConfig = require('../config/streamerConfig');

// State to track online status and avoid duplicate notifications
// Key: "platform:channelName", Value: { isOnline: boolean, lastNotificationTime: number }
const streamState = new Map();

// Twitch Auth cache
let twitchAccessToken = null;
let twitchTokenExpiry = 0;

/**
 * Main function to start the monitoring loop
 * @param {import('discord.js').Client} client 
 */
function startStreamMonitor(client) {
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
        console.warn("⚠️ StreamMonitor: Twitch Client ID or Secret missing in .env. Twitch monitoring disabled.");
    }

    // Run immediately on start
    checkAllStreams(client);

    // Poll every 2 minutes (120 seconds) to stay within reasonable API limits
    setInterval(() => checkAllStreams(client), 120 * 1000);
}

async function checkAllStreams(client) {
    console.log("🔍 Checking stream status...");

    // Iterate over each guild in the config
    for (const [guildId, config] of Object.entries(streamerConfig)) {
        if (!config.notificationChannelId) continue;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            // Guild might not be loaded or bot is not in it
            continue;
        }

        const channel = guild.channels.cache.get(config.notificationChannelId);
        if (!channel) {
            console.warn(`⚠️ Notification channel ${config.notificationChannelId} not found in guild ${guildId}`);
            continue;
        }

        // Check Twitch
        if (config.twitch && config.twitch.length > 0) {
            await checkTwitch(config.twitch, channel);
        }

        // Check Kick
        if (config.kick && config.kick.length > 0) {
            await checkKick(config.kick, channel);
        }
    }
}

// --- Twitch Implementation ---

async function getTwitchAccessToken() {
    const now = Date.now();
    if (twitchAccessToken && now < twitchTokenExpiry) {
        return twitchAccessToken;
    }

    try {
        const response = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.access_token) {
            twitchAccessToken = data.access_token;
            // set expiry (expires_in is in seconds), reduce by 5 mins for safety
            twitchTokenExpiry = now + (data.expires_in * 1000) - 300000;
            return twitchAccessToken;
        } else {
            console.error("❌ Failed to get Twitch Access Token:", data);
            return null;
        }
    } catch (error) {
        console.error("❌ Error fetching Twitch Token:", error);
        return null;
    }
}

async function checkTwitch(channels, discordChannel) {
    const token = await getTwitchAccessToken();
    if (!token) return;

    // Split into chunks of 100 (Twitch API limit)
    const chunks = [];
    for (let i = 0; i < channels.length; i += 100) {
        chunks.push(channels.slice(i, i + 100));
    }

    for (const chunk of chunks) {
        const query = chunk.map(c => `user_login=${c}`).join('&');
        try {
            const response = await fetch(`https://api.twitch.tv/helix/streams?${query}`, {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();

            if (!data.data) { // Error or empty
                continue;
            }

            // Create a set of currently online users from the API response
            const onlineUsers = new Map();
            data.data.forEach(stream => {
                if (stream.type === 'live') {
                    onlineUsers.set(stream.user_login.toLowerCase(), stream);
                }
            });

            // Process each monitored channel
            for (const channelName of chunk) {
                const key = `twitch:${channelName.toLowerCase()}`;
                const streamData = onlineUsers.get(channelName.toLowerCase());
                const wasOnline = streamState.get(key)?.isOnline || false;

                if (streamData && !wasOnline) {
                    // Went Online
                    streamState.set(key, { isOnline: true, lastNotificationTime: Date.now() });
                    sendNotification(discordChannel, {
                        platform: 'Twitch',
                        user: streamData.user_name,
                        title: streamData.title,
                        game: streamData.game_name,
                        url: `https://twitch.tv/${channelName}`,
                        thumbnail: streamData.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
                    });
                } else if (!streamData && wasOnline) {
                    // Went Offline
                    streamState.set(key, { isOnline: false, lastNotificationTime: Date.now() });
                }
            }

        } catch (error) {
            console.error(`❌ Error checking Twitch streams:`, error);
        }
    }
}

// --- Kick Implementation ---

async function checkKick(channels, discordChannel) {
    for (const channelName of channels) {
        const key = `kick:${channelName.toLowerCase()}`;

        try {
            const response = await fetch(`https://kick.com/api/v1/channels/${channelName}`);

            if (response.status === 403 || response.status === 503) {
                // Cloudflare often blocks these requests
                // Failing silently to avoid log spam, or log once
                // console.warn(`⚠️ Kick API blocked for ${channelName} (Cloudflare).`);
                continue;
            }

            if (!response.ok) continue;

            const data = await response.json();
            // Kick data structure: { livestream: { ... } | null, ... }
            const isLive = data.livestream && data.livestream.is_live;
            const wasOnline = streamState.get(key)?.isOnline || false;

            if (isLive && !wasOnline) {
                streamState.set(key, { isOnline: true, lastNotificationTime: Date.now() });
                sendNotification(discordChannel, {
                    platform: 'Kick',
                    user: data.user?.username || channelName,
                    title: data.livestream.session_title,
                    game: data.livestream.categories?.[0]?.name || 'Unknown',
                    url: `https://kick.com/${channelName}`,
                    thumbnail: data.livestream.thumbnail?.url
                });
            } else if (!isLive && wasOnline) {
                streamState.set(key, { isOnline: false, lastNotificationTime: Date.now() });
            }

        } catch (error) {
            // Retrieve failure, ignore
        }
    }
}

// --- Notification Helper ---

async function sendNotification(channel, info) {
    const message = `@everyone **${info.user}** şimdi **${info.platform}** üzerinde yayında!\n\n**${info.title}**\n🔴 Oynuyor: ${info.game}\n🔗 ${info.url}`;

    try {
        await channel.send({
            content: message,
            allowedMentions: { parse: ['everyone'] }
        });
        console.log(`✅ Notification sent for ${info.user} on ${info.platform}`);
    } catch (error) {
        console.error(`❌ Failed to send notification for ${info.user}:`, error);
    }
}

module.exports = { startStreamMonitor };
