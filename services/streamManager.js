const storage = require('./storage');

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

let twitchAccessToken = null;
let twitchTokenExpiry = 0;

async function getTwitchAccessToken() {
    const now = Date.now();
    if (twitchAccessToken && now < twitchTokenExpiry) return twitchAccessToken;

    try {
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
        twitchTokenExpiry = now + (data.expires_in * 1000) - 60000; // Buffer 60s
        return twitchAccessToken;
    } catch (e) {
        console.error("Failed to get Twitch Token:", e);
        return null;
    }
}

async function checkTwitchStreams(channels) {
    if (!channels || channels.length === 0) return [];

    const token = await getTwitchAccessToken();
    if (!token) return [];

    const results = [];

    // Chunking 100
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
                console.error(`Twitch API Error: ${res.status}`);
                continue;
            }

            const data = await res.json();
            // data.data is array of online streams
            results.push(...data.data);
        } catch (e) {
            console.error("Twitch Check Error:", e);
        }
    }
    return results;
}

// --- Kick Provider ---

async function checkKickStream(slug) {
    try {
        // Using public API endpoint logic (unofficial but standard for these bots)
        const res = await fetchWithTimeout(`https://kick.com/api/v1/channels/${slug}`);
        if (!res.ok) return null;

        const data = await res.json();
        if (data && data.livestream && data.livestream.is_live) {
            return {
                user_name: data.user.username,
                game_name: data.livestream.categories?.[0]?.name || 'Unknown',
                title: data.livestream.session_title,
                thumbnail_url: data.livestream.thumbnail?.url,
                viewer_count: data.livestream.viewer_count,
                started_at: data.livestream.created_at, // or similar
                id: data.livestream.id
            };
        }
        return null;
    } catch (e) {
        // Kick checks often fail due to cloudflare or timeouts, log verbose only if debugging
        // console.error(`Kick Check Error for ${slug}:`, e.message);
        return null; // Assume offline on error to avoid spam
    }
}

// --- Main Manager ---

async function runCheck(client) {
    // console.log("Running Stream Check...");
    const watched = storage.getAllWatchedChannels();
    const twitchChannels = Array.from(watched.twitch);
    const kickChannels = Array.from(watched.kick);

    // 1. Check Twitch
    if (twitchChannels.length > 0) {
        const onlineStreams = await checkTwitchStreams(twitchChannels);
        const onlineMap = new Map(onlineStreams.map(s => [s.user_login.toLowerCase(), s]));

        for (const channel of twitchChannels) {
            const stream = onlineMap.get(channel.toLowerCase());
            await processStreamState(client, 'twitch', channel, stream);
        }
    }

    // 2. Check Kick (Parallel)
    await Promise.all(kickChannels.map(async (slug) => {
        const stream = await checkKickStream(slug);
        await processStreamState(client, 'kick', slug, stream);
    }));
}

async function processStreamState(client, platform, identifier, streamData) {
    const currentState = storage.getStreamState(platform, identifier);
    const isOnline = !!streamData;

    // Logic: Offline -> Online = Notify
    if (isOnline && currentState.lastStatus !== 'online') {
        // DEDUPE CHECK: Check if stream ID matches last known ID (if available) to prevent restart spam
        // For Twitch: streamData.id
        // For Kick: streamData.id
        const streamId = streamData.id || `session_${Date.now()}`; // Fallback

        if (currentState.lastStreamId === streamId) {
            // Already notified for this exact stream session
            storage.updateStreamState(platform, identifier, { lastStatus: 'online' });
            return;
        }

        // Send Notification
        await broadcastNotification(client, platform, identifier, streamData);

        storage.updateStreamState(platform, identifier, {
            lastStatus: 'online',
            lastNotified: Date.now(),
            lastStreamId: streamId
        });

    } else if (!isOnline && currentState.lastStatus === 'online') {
        // Went Offline
        storage.updateStreamState(platform, identifier, { lastStatus: 'offline' });
    } else if (isOnline) {
        // Still Online, just update heartbeat if needed
    }
}

async function broadcastNotification(client, platform, identifier, info) {
    // Find all guilds watching this specific channel
    const guildsData = storage.data.guilds;

    for (const [guildId, config] of Object.entries(guildsData)) {
        if (!config.notifyChannelId) continue;

        // Check if this guild is watching this specific streamer
        const isWatching = config.watched.some(w => w.platform === platform && w.identifier === identifier);
        if (!isWatching) continue;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const channel = guild.channels.cache.get(config.notifyChannelId);
        if (!channel) {
            console.warn(`Notify channel missing for guild ${guild.name}`);
            continue;
        }

        // Check Permissions
        const permissions = channel.permissionsFor(guild.members.me);
        if (!permissions.has('SendMessages')) {
            console.warn(`Missing SendMessages permission in ${channel.name}`);
            continue;
        }

        let mentionText = '';
        if (config.mentionsEnabled) { // This maps to "Everyone" or similar. Default off in model but requested to be configurable.
            // Request said: "@everyone mention opsiyonel olsun (guild ayarı)"
            // Also: "Botun rol/kanal izinlerinde 'Mention Everyone' yoksa log’a uyarı düş"
            if (permissions.has('MentionEveryone')) {
                mentionText = '@everyone ';
            } else {
                console.warn(`[WARN] Missing 'Mention Everyone' permission in guild: ${guild.name}`);
                mentionText = ''; // Fallback to no ping or maybe @here if allowed? Prompt says warn.
            }
        }

        // Format: "@everyone 🔴 {platform} | {channelName} yayında! {url}"
        const url = platform === 'twitch' ? `https://twitch.tv/${identifier}` : `https://kick.com/${identifier}`;
        const msg = `${mentionText}🔴 ${platform.charAt(0).toUpperCase() + platform.slice(1)} | **${info.user_name}** yayında! ${url}\n> **${info.title}**\n> 🎮 ${info.game_name}`;

        try {
            await channel.send({
                content: msg,
                allowedMentions: { parse: config.mentionsEnabled ? ['everyone'] : [] }
            });
        } catch (err) {
            console.error(`Failed to send notification to ${guild.name}:`, err);
        }
    }
}

function startStreamManager(client) {
    console.log("Stream Manager Started.");
    runCheck(client); // Immediate run
    setInterval(() => runCheck(client), 60 * 1000); // 60s Polling
}

module.exports = { startStreamManager };
