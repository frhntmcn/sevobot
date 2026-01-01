const storage = require('./storage');
const logger = require('./logger');

// --- Helpers ---

async function fetchWithTimeout(url, options = {}, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

// --- Twitch Provider ---

async function getTwitchAccessToken() {
    const now = Date.now();
    if (twitchAccessToken && now < twitchTokenExpiry) return twitchAccessToken;

    try {
        logger.log("🔄 Requesting new Twitch Access Token...");
        const params = new URLSearchParams({
            client_id: process.env.TWITCH_CLIENT_ID,
            client_secret: process.env.TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials'
        });

        const res = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            body: params
        });

        if (!res.ok) throw new Error(`Twitch Auth Error: ${res.statusText}`);

        const data = await res.json();
        twitchAccessToken = data.access_token;
        twitchTokenExpiry = now + (data.expires_in * 1000) - 60000;
        logger.log("✅ Twitch Token Acquired.");
        return twitchAccessToken;
    } catch (e) {
        logger.error("❌ Failed to get Twitch Token:", e);
        return null;
    }
}

async function checkTwitchStreams(channels) {
    if (!channels || channels.length === 0) return [];

    const token = await getTwitchAccessToken();
    if (!token) return [];

    const results = [];
    logger.log(`🔎 Checking ${channels.length} Twitch channels...`);

    for (let i = 0; i < channels.length; i += 100) {
        const chunk = channels.slice(i, i + 100);
        const query = chunk.map(c => `user_login=${c}`).join('&');

        try {
            const res = await fetch(`https://api.twitch.tv/helix/streams?${query}`, {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) {
                logger.error(`❌ Twitch API Error: ${res.status} ${res.statusText}`);
                continue;
            }

            const data = await res.json();
            logger.log(`✅ Twitch API: Found ${data.data.length} live streams in chunk.`);
            results.push(...data.data);
        } catch (e) {
            logger.error("❌ Twitch Check Error:", e);
        }
    }
    return results;
}

// --- Kick Provider ---

async function checkKickStream(slug) {
    try {
        const res = await fetchWithTimeout(`https://kick.com/api/v1/channels/${slug}`);
        if (!res.ok) {
            logger.warn(`⚠️ Kick API for ${slug}: ${res.status}`);
            return null;
        }

        const data = await res.json();
        if (data && data.livestream && data.livestream.is_live) {
            return {
                user_name: data.user.username,
                game_name: data.livestream.categories?.[0]?.name || 'Unknown',
                title: data.livestream.session_title,
                thumbnail_url: data.livestream.thumbnail?.url,
                viewer_count: data.livestream.viewer_count,
                started_at: data.livestream.created_at,
                id: data.livestream.id
            };
        }
        return null;
    } catch (e) {
        logger.error(`❌ Kick Check Error for ${slug}:`, e.message);
        return null;
    }
}

// --- Main Manager ---

async function runCheck(client) {
    logger.log("⏱️ --- Starting Stream Check Cycle ---");
    const watched = storage.getAllWatchedChannels();
    const twitchChannels = Array.from(watched.twitch);
    const kickChannels = Array.from(watched.kick);

    if (twitchChannels.length > 0) {
        const onlineStreams = await checkTwitchStreams(twitchChannels);
        const onlineMap = new Map(onlineStreams.map(s => [s.user_login.toLowerCase(), s]));

        for (const channel of twitchChannels) {
            const stream = onlineMap.get(channel.toLowerCase());
            await processStreamState(client, 'twitch', channel, stream);
        }
    } else {
        logger.log("ℹ️ No Twitch channels to check.");
    }

    if (kickChannels.length > 0) {
        logger.log(`🔎 Checking ${kickChannels.length} Kick channels...`);
        await Promise.all(kickChannels.map(async (slug) => {
            const stream = await checkKickStream(slug);
            await processStreamState(client, 'kick', slug, stream);
        }));
    } else {
        logger.log("ℹ️ No Kick channels to check.");
    }
}

async function processStreamState(client, platform, identifier, streamData) {
    const currentState = storage.getStreamState(platform, identifier);
    const isOnline = !!streamData;

    // Verbose logic logging
    if (isOnline) {
        const streamId = streamData.id || `session_${Date.now()}`;

        if (currentState.lastStatus !== 'online') {
            console.log(`🟢 [${platform}] ${identifier} Came ONLINE (ID: ${streamId})`);
            await broadcastNotification(client, platform, identifier, streamData);

            storage.updateStreamState(platform, identifier, {
                lastStatus: 'online',
                lastNotified: Date.now(),
                lastStreamId: streamId
            });
        } else {
            // Already online
            if (currentState.lastStreamId === streamId) {
                // Same stream, do nothing
            } else {
                console.log(`🔄 [${platform}] ${identifier} New Stream Session Detected (Old: ${currentState.lastStreamId} -> New: ${streamId})`);
                await broadcastNotification(client, platform, identifier, streamData);

                storage.updateStreamState(platform, identifier, {
                    lastStatus: 'online',
                    lastNotified: Date.now(),
                    lastStreamId: streamId
                });
            }
        }
    } else {
        if (currentState.lastStatus === 'online') {
            console.log(`🔴 [${platform}] ${identifier} Went OFFLINE`);
            storage.updateStreamState(platform, identifier, { lastStatus: 'offline' });
        }
    }
}

async function broadcastNotification(client, platform, identifier, info) {
    logger.log(`📢 Preparing notification for ${identifier} (${platform})...`);
    const guildsData = storage.data.guilds;

    for (const [guildId, config] of Object.entries(guildsData)) {
        if (!config.notifyChannelId) continue;

        const isWatching = config.watched.some(w => w.platform === platform && w.identifier === identifier);
        if (!isWatching) continue;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            logger.warn(`⚠️ Guild ${guildId} not found in cache.`);
            continue;
        }

        const channel = guild.channels.cache.get(config.notifyChannelId);
        if (!channel) {
            logger.warn(`⚠️ Notify channel ${config.notifyChannelId} missing for guild ${guild.name}`);
            continue;
        }

        const permissions = channel.permissionsFor(guild.members.me);
        if (!permissions.has('SendMessages')) {
            logger.error(`❌ Missing SendMessages permission in ${channel.name} (${guild.name})`);
            continue;
        }

        let mentionText = '';
        if (config.mentionsEnabled) {
            if (permissions.has('MentionEveryone')) {
                mentionText = '@everyone ';
            } else {
                logger.warn(`⚠️ Missing 'Mention Everyone' permission in guild: ${guild.name}`);
            }
        }

        const url = platform === 'twitch' ? `https://twitch.tv/${identifier}` : `https://kick.com/${identifier}`;
        const msg = `${mentionText}🔴 ${platform.charAt(0).toUpperCase() + platform.slice(1)} | **${info.user_name}** yayında! ${url}\n> **${info.title}**\n> 🎮 ${info.game_name}`;

        try {
            await channel.send({
                content: msg,
                allowedMentions: { parse: config.mentionsEnabled ? ['everyone'] : [] }
            });
            logger.log(`✅ Notification sent to ${guild.name} (#${channel.name})`);
        } catch (err) {
            logger.error(`❌ Failed to send notification to ${guild.name}:`, err);
        }
    }
}

function startStreamManager(client) {
    logger.log("🚀 Stream Manager Initialized.");
    runCheck(client);
    setInterval(() => runCheck(client), 60 * 1000);
}

module.exports = { startStreamManager };
