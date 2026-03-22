const storage = require('./storage');
const logger = require('./logger');
const { processVod } = require('./kickVodManager');
const puppeteerHelper = require('./puppeteerHelper');

let browserInstance = null;

async function getBrowser() {
    browserInstance = await puppeteerHelper.getBrowser();
    return browserInstance;
}



// --- Helpers ---

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
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

async function getTwitchAccessToken(retries = 3) {
    const now = Date.now();
    if (twitchAccessToken && now < twitchTokenExpiry) return twitchAccessToken;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.log(`🔄 Requesting new Twitch Access Token... (Attempt ${attempt}/${retries})`);
            const params = new URLSearchParams({
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials'
            });

            const res = await fetch('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                body: params,
                // Higher internal timeout for token request
                signal: AbortSignal.timeout(15000)
            });

            if (!res.ok) throw new Error(`Twitch Auth Error: ${res.statusText}`);

            const data = await res.json();
            twitchAccessToken = data.access_token;
            twitchTokenExpiry = now + (data.expires_in * 1000) - 60000;
            logger.log("✅ Twitch Token Acquired.");
            return twitchAccessToken;
        } catch (e) {
            logger.error(`❌ Attempt ${attempt} failed to get Twitch Token:`, e.message);
            if (attempt === retries) return null;
            // Wait before next attempt (exponential backoff: 2s, 4s, 8s...)
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(r => setTimeout(r, delay));
        }
    }
    return null;
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
    let page = null;
    try {
        const result = await puppeteerHelper.createPage();
        if (!result) return null;
        page = result.page;

        logger.log(`[Kick] [${slug}] Navigating to API...`);
        await page.goto(`https://kick.com/api/v1/channels/${slug}`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        logger.log(`[Kick] [${slug}] Navigation complete.`);

        const content = await page.evaluate(() => document.body.innerText);
        let data;
        try {
            data = JSON.parse(content);
        } catch (e) {
            if (content.includes('verify your connection') || content.includes('Cloudflare')) {
                logger.warn(`⚠️ Kick Cloudflare active for ${slug}.`);
            }
            return null;
        }

        if (data && data.livestream && data.livestream.is_live) {
            return {
                user_name: data.user?.username || slug,
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
        logger.error(`❌ Kick Puppeteer Error [${slug}]:`, e.message);
        if (e.message.includes('disconnected')) browserInstance = null;
        return null;
    } finally {
        if (page) await page.close().catch(() => { });
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
            logger.log(`🟢 [${platform}] ${identifier} Came ONLINE (ID: ${streamId})`);
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
                logger.log(`🔄 [${platform}] ${identifier} New Stream Session Detected (Old: ${currentState.lastStreamId} -> New: ${streamId})`);
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
            logger.log(`🔴 [${platform}] ${identifier} Went OFFLINE`);
            storage.updateStreamState(platform, identifier, { lastStatus: 'offline' });

            // Trigger VOD processing for Kick
            if (platform === 'kick') {
                // Check if VOD downloading is ENABLED for this channel
                if (storage.shouldDownloadVod('kick', identifier)) {
                    logger.log(`⏲️ [KickVOD] Scheduling VOD download for ${identifier} in 5 minutes...`);
                    setTimeout(() => {
                        processVod(identifier);
                    }, 5 * 60 * 1000);
                } else {
                    logger.log(`ℹ️ [KickVOD] Skipping download for ${identifier} (VOD disabled).`);
                }
            }
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

        let targetChannel = null;
        let isDM = false;

        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            targetChannel = guild.channels.cache.get(config.notifyChannelId);
            if (!targetChannel) {
                logger.warn(`⚠️ Notify channel ${config.notifyChannelId} missing for guild ${guild.name}`);
                continue;
            }

            const permissions = targetChannel.permissionsFor(guild.members.me);
            if (!permissions || !permissions.has('SendMessages') || !permissions.has('ViewChannel') || !permissions.has('ReadMessageHistory')) {
                logger.error(`❌ Missing permissions (Send/View/ReadHistory) in ${targetChannel.name} (${guild.name})`);
                continue;
            }
        } else {
            // Might be a DM
            try {
                const user = await client.users.fetch(guildId);
                targetChannel = user;
                isDM = true;
            } catch (error) {
                logger.warn(`⚠️ Could not find guild or user for ID: ${guildId}`);
                continue;
            }
        }


        // --- STATELESS DEDUPLICATION ---
        // Vercel resets memory, so we check Discord history to see if we already notified.
        try {
            // Using dm channel or regular channel
            let channelFetchTarget = targetChannel;
            if (isDM && !targetChannel.dmChannel) {
                channelFetchTarget = await targetChannel.createDM();
            } else if (isDM) {
                channelFetchTarget = targetChannel.dmChannel;
            }

            if (channelFetchTarget && channelFetchTarget.messages) {
                const messages = await channelFetchTarget.messages.fetch({ limit: 20 });
                const streamUrl = platform === 'twitch' ? `twitch.tv/${identifier}` : `kick.com/${identifier}`;
                const streamStart = new Date(info.started_at).getTime();

                const alreadyNotified = messages.some(msg => {
                    // Check if message contains the streamer link
                    if (!msg.content.toLowerCase().includes(streamUrl.toLowerCase())) return false;

                    // If message is from THIS bot
                    if (msg.author.id !== client.user.id) return false;

                    // CRITICAL: If message was sent AFTER the stream started, it's a valid notification.
                    // We don't want to send another one.
                    return msg.createdTimestamp > streamStart;
                });

                if (alreadyNotified) {
                    logger.log(`⏭️ Skipping ${identifier}: Notification already exists for ${isDM ? 'User ' + targetChannel.tag : '#' + targetChannel.name}.`);
                    continue;
                }
            }

        } catch (err) {
            logger.error(`⚠️ Failed to check message history for target ${isDM ? targetChannel.tag : targetChannel.name}:`, err);
            // On error, we proceed safely? Or skip to avoid spam? 
            // Better to skip if history fails to avoid potential spam loop.
            continue;
        }
        // -------------------------------

        let mentionText = '';
        if (!isDM && config.mentionsEnabled) {
            const permissions = targetChannel.permissionsFor(guild.members.me);
            if (permissions && permissions.has('MentionEveryone')) {
                mentionText = '@everyone ';
            } else {
                logger.warn(`⚠️ Missing 'Mention Everyone' permission in guild: ${guild.name}`);
            }
        }

        const url = platform === 'twitch' ? `https://twitch.tv/${identifier}` : `https://kick.com/${identifier}`;
        const msg = `${mentionText}🔴 ${platform.charAt(0).toUpperCase() + platform.slice(1)} | **${info.user_name}** yayında! ${url}\n> **${info.title}**\n> 🎮 ${info.game_name}`;

        try {
            await targetChannel.send({
                content: msg,
                allowedMentions: { parse: (!isDM && config.mentionsEnabled) ? ['everyone'] : [] }
            });
            logger.log(`✅ Notification sent to ${isDM ? 'User ' + targetChannel.tag : guild.name + ' (#' + targetChannel.name + ')'}`);
        } catch (err) {
            logger.error(`❌ Failed to send notification to ${isDM ? 'User ' + targetChannel.tag : guild.name}:`, err);
        }
    }
}

function startStreamManager(client) {
    logger.log("🚀 Stream Manager Initialized.");
    runCheck(client);
    setInterval(() => runCheck(client), 60 * 1000);
}

module.exports = { startStreamManager, runCheck };
