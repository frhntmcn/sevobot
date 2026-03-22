/**
 * Kick.com Chat Manager
 * 
 * Kick'in Pusher (WebSocket) altyapısını kullanarak belirli bir kanalın
 * sohbetini dinler, komutlara yanıt verir ve zamanlanmış mesajlar gönderir.
 * 
 * Kullanım:
 *   const kickChatManager = require('./services/kickChatManager');
 *   kickChatManager.init(discordClient, 'kanal_adi');
 */

const Pusher = require('pusher-js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const storage = require('./storage');

// --- Config & Data Paths ---
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'kickConfig.json');
const STATS_PATH = path.join(__dirname, '..', 'data', 'kickChatStats.json');
const STATUS_PATH = path.join(__dirname, '..', 'data', 'kickStatus.json');

let config = loadConfig();
let pusherClient = null;
let chatroomId = null;
let broadcasterUserId = null;
let activeTimers = [];
let discordClient = null;
let isInitialized = false;

// Stream-aware timer throttling
let isStreamLive = false;
let streamCheckTimer = null;
const lastOfflineTimerSent = {};  // { timerId: timestamp }
const OFFLINE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 saat

// Runtime stats
const stats = {
    connectedAt: null,
    messagesReceived: 0,
    commandsProcessed: 0,
    timerMessagesSent: 0,
    lastError: null
};

// Per-user chat message counts
let chatStats = loadChatStats();
let chatStatsDirty = false;
let chatStatsSaveTimer = null;

// ============================================================
// CONFIG MANAGEMENT
// ============================================================

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (err) {
        logger.error('[KickChat] Failed to load config:', err.message);
    }

    // Default config
    return {
        channelName: '',
        pusher: { appKey: '32cbd69e4b950bf97679', cluster: 'us2' },
        timers: [],
        commands: {}
    };
}

function loadChatStats() {
    try {
        if (fs.existsSync(STATS_PATH)) {
            const raw = fs.readFileSync(STATS_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (err) {
        logger.error('[KickChat] Failed to load chat stats:', err.message);
    }
    return {};
}

function saveChatStats() {
    if (!chatStatsDirty) return;
    try {
        const dir = path.dirname(STATS_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(STATS_PATH, JSON.stringify(chatStats, null, 2), 'utf-8');
        chatStatsDirty = false;
    } catch (err) {
        logger.error('[KickChat] Failed to save chat stats:', err.message);
    }
}

function trackMessage(username) {
    if (!username) return;
    if (!chatStats[username]) {
        chatStats[username] = 0;
    }
    chatStats[username]++;
    chatStatsDirty = true;
}

function getChatStats() {
    return { ...chatStats };
}

function resetChatStats() {
    chatStats = {};
    chatStatsDirty = true;
    saveChatStats();
    return chatStats;
}

function saveConfig() {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
        logger.log('[KickChat] Config saved.');
    } catch (err) {
        logger.error('[KickChat] Failed to save config:', err.message);
    }
}

function getConfig() {
    return { ...config };
}

function updateConfig(newConfig) {
    const oldTimersEnabled = config.timers?.some(t => t.enabled);

    config = { ...config, ...newConfig };
    saveConfig();

    // Restart timers if they changed
    if (newConfig.timers && chatroomId) {
        stopTimers();
        startTimers(chatroomId);
    }

    logger.log('[KickChat] Config updated at runtime.');
    return config;
}

// ============================================================
// CHATROOM ID RESOLUTION
// ============================================================

/**
 * Kick API'den chatroom_id'yi çeker.
 * Önce doğrudan fetch dener; Cloudflare engeli varsa Puppeteer ile bypass yapar.
 */
async function getChatroomId(channelName) {
    // --- Yöntem 1: Doğrudan Fetch ---
    try {
        logger.log(`[KickChat] Fetching chatroom ID for "${channelName}" via API...`);
        const res = await fetch(`https://kick.com/api/v2/channels/${channelName}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(15000)
        });

        if (res.ok) {
            const data = await res.json();
            if (data && data.chatroom && data.chatroom.id) {
                logger.log(`[KickChat] ✅ Chatroom ID (via fetch): ${data.chatroom.id}`);
                // Also store broadcaster user ID for the new API
                if (data.user && data.user.id) {
                    broadcasterUserId = data.user.id;
                    logger.log(`[KickChat] ✅ Broadcaster User ID: ${broadcasterUserId}`);
                }
                return data.chatroom.id;
            }
        }
    } catch (err) {
        logger.warn(`[KickChat] Direct fetch failed: ${err.message}. Trying Puppeteer...`);
    }

    // --- Yöntem 2: Puppeteer (Cloudflare Bypass) ---
    try {
        const puppeteerHelper = require('./puppeteerHelper');

        logger.log(`[KickChat] Launching Puppeteer for chatroom ID...`);
        const result = await puppeteerHelper.withIsolatedBrowser(async (browser, page) => {
            await page.goto(`https://kick.com/api/v2/channels/${channelName}`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            const content = await page.evaluate(() => document.body.innerText);
            return JSON.parse(content);
        });

        if (result && result.chatroom && result.chatroom.id) {
            logger.log(`[KickChat] ✅ Chatroom ID (via Puppeteer): ${result.chatroom.id}`);
            if (result.user && result.user.id) {
                broadcasterUserId = result.user.id;
                logger.log(`[KickChat] ✅ Broadcaster User ID: ${broadcasterUserId}`);
            }
            return result.chatroom.id;
        }
    } catch (err) {
        logger.error(`[KickChat] ❌ Puppeteer fallback failed: ${err.message}`);
    }

    return null;
}

// ============================================================
// PUSHER / WEBSOCKET CONNECTION
// ============================================================

function connectToPusher(roomId) {
    const { appKey, cluster } = config.pusher;

    logger.log(`[KickChat] Connecting to Pusher (key: ${appKey}, cluster: ${cluster})...`);

    pusherClient = new Pusher(appKey, {
        cluster: cluster,
        forceTLS: true,
        // pusher-js has built-in auto-reconnect
    });

    // Connection state monitoring
    pusherClient.connection.bind('state_change', (states) => {
        logger.log(`[KickChat] Pusher: ${states.previous} → ${states.current}`);

        if (states.current === 'connected') {
            stats.connectedAt = new Date().toISOString();
            stats.lastError = null;
            logger.log('[KickChat] ✅ WebSocket connected!');
            getStatus(); // write status file
        }

        if (states.current === 'disconnected' || states.current === 'failed') {
            stats.lastError = `Connection ${states.current} at ${new Date().toISOString()}`;
            logger.warn(`[KickChat] ⚠️ WebSocket ${states.current}. Auto-reconnect will attempt...`);
        }

        if (states.current === 'unavailable') {
            logger.error('[KickChat] ❌ WebSocket unavailable. Will keep retrying...');
        }
    });

    pusherClient.connection.bind('error', (err) => {
        stats.lastError = err.message || 'Unknown Pusher error';
        logger.error('[KickChat] ❌ Pusher error:', err);
    });

    // Subscribe to chatroom channel
    const channelName = `chatrooms.${roomId}.v2`;
    const channel = pusherClient.subscribe(channelName);

    channel.bind('pusher:subscription_succeeded', () => {
        logger.log(`[KickChat] ✅ Subscribed to ${channelName}`);
    });

    channel.bind('pusher:subscription_error', (err) => {
        logger.error(`[KickChat] ❌ Subscription error for ${channelName}:`, err);
    });

    // Listen for ALL events and handle chat messages
    channel.bind_global((eventName, data) => {
        if (eventName.startsWith('pusher:')) return;

        // Chat message events
        if (eventName.includes('ChatMessageEvent') && data && data.content) {
            handleChatMessage(data, roomId);
        }
    });

    logger.log(`[KickChat] Listening for messages on ${channelName}...`);
}

function disconnectPusher() {
    if (pusherClient) {
        pusherClient.disconnect();
        pusherClient = null;
        logger.log('[KickChat] Pusher disconnected.');
    }
}

// ============================================================
// CHAT MESSAGE HANDLING
// ============================================================

async function handleChatMessage(data, roomId) {
    stats.messagesReceived++;

    // Reload config from disk each time so dashboard changes take effect immediately
    config = loadConfig();

    try {
        const senderName = data.sender?.username || data.sender?.slug || 'Unknown';
        const messageContent = data.content || '';

        // Track message count for this user
        trackMessage(senderName);

        // Don't process bot's own messages (avoid loops)
        const botName = 'SevoBot';
        if (senderName.toLowerCase() === botName.toLowerCase()) return;

        logger.log(`[KickChat] 💬 ${senderName}: ${messageContent}`);

        // Check for commands
        const trimmedMsg = messageContent.trim().toLowerCase();
        const commands = config.commands || {};

        // Auto-generate !komutlar response
        if (trimmedMsg === '!komutlar') {
            stats.commandsProcessed++;
            const cmdNames = Object.keys(commands)
                .filter(c => c.toLowerCase() !== '!komutlar')
                .sort();
            const response = cmdNames.length > 0
                ? '📋 Komutlar: ' + cmdNames.join(', ')
                : '📋 Henüz komut eklenmedi.';
            logger.log('[KickChat] 🎯 Command matched: !komutlar (auto-generated)');
            sendMessage(roomId, response);
            return;
        }

        for (const [cmd, response] of Object.entries(commands)) {
            if (cmd.toLowerCase() === '!komutlar') continue; // skip, handled above
            if (trimmedMsg === cmd.toLowerCase()) {
                stats.commandsProcessed++;
                logger.log(`[KickChat] 🎯 Command matched: ${cmd}`);
                // Process template variables like $(urlfetch URL)
                const processedResponse = await processTemplateVariables(response);
                sendMessage(roomId, processedResponse);
                return;
            }
        }
    } catch (err) {
        logger.error('[KickChat] Error handling message:', err.message);
    }
}

/**
 * $(urlfetch URL) gibi template değişkenlerini işler.
 * URL'den gelen yanıtı alıp, template'in yerine koyar.
 */
async function processTemplateVariables(text) {
    // Match $(urlfetch URL) patterns
    const regex = /\$\(urlfetch\s+(https?:\/\/[^)]+)\)/gi;
    const matches = [...text.matchAll(regex)];

    if (matches.length === 0) return text;

    let result = text;

    for (const match of matches) {
        const fullMatch = match[0]; // $(urlfetch https://...)
        const url = match[1];       // https://...

        try {
            logger.log(`[KickChat] 🌐 Fetching: ${url}`);
            const res = await fetch(url, {
                headers: { 'User-Agent': 'SevoBot/1.0' },
                signal: AbortSignal.timeout(8000)
            });

            if (res.ok) {
                const fetchedText = (await res.text()).trim();
                result = result.replace(fullMatch, fetchedText);
                logger.log(`[KickChat] ✅ Fetched: "${fetchedText.substring(0, 80)}..."`);
            } else {
                logger.error(`[KickChat] ❌ urlfetch failed (${res.status}) for ${url}`);
                result = result.replace(fullMatch, '⚠️ Veri alınamadı');
            }
        } catch (err) {
            logger.error(`[KickChat] ❌ urlfetch error: ${err.message}`);
            result = result.replace(fullMatch, '⚠️ Bağlantı hatası');
        }
    }

    return result;
}

// ============================================================
// MESSAGE SENDING (Kick API)
// ============================================================

/**
 * Kick OAuth token'ını refresh_token kullanarak yeniler.
 * Yeni token'ları hem process.env'ye hem .env dosyasına yazar.
 */
async function refreshOAuthToken() {
    const clientId = process.env.KICK_CLIENT_ID;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    const refreshToken = process.env.KICK_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        logger.error('[KickChat] ❌ Cannot refresh token: missing KICK_CLIENT_ID, KICK_CLIENT_SECRET, or KICK_REFRESH_TOKEN');
        return false;
    }

    try {
        logger.log('[KickChat] 🔄 Refreshing OAuth token...');
        const res = await fetch('https://id.kick.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken
            }),
            signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
            logger.error(`[KickChat] ❌ Token refresh failed (${res.status})`);
            return false;
        }

        const data = await res.json();
        process.env.KICK_OAUTH_TOKEN = data.access_token;
        process.env.KICK_REFRESH_TOKEN = data.refresh_token;

        // Persist to .env file (with backup)
        try {
            const envPath = path.join(__dirname, '..', '.env');
            const backupPath = envPath + '.backup';
            let envContent = fs.readFileSync(envPath, 'utf-8');

            // Güvenlik: boş dosyaya yazma — bu durumda .env'i bozma
            if (envContent.trim().length === 0) {
                logger.warn('[KickChat] ⚠️ .env dosyası boş! Token yazılmadı (dosya bozulmasın).');
            } else {
                // Yazmadan önce yedekle
                fs.copyFileSync(envPath, backupPath);
                logger.log('[KickChat] 📋 .env yedeği oluşturuldu: .env.backup');

                envContent = envContent.replace(/KICK_OAUTH_TOKEN=.*/g, `KICK_OAUTH_TOKEN=${data.access_token}`);
                envContent = envContent.replace(/KICK_REFRESH_TOKEN=.*/g, `KICK_REFRESH_TOKEN=${data.refresh_token}`);

                // Son kontrol: yeni içerik boş olmamalı
                if (envContent.trim().length > 0) {
                    fs.writeFileSync(envPath, envContent, 'utf-8');
                    logger.log('[KickChat] ✅ Token .env dosyasına kaydedildi.');
                } else {
                    logger.error('[KickChat] ❌ Güncellenen .env içeriği boş! Yazma iptal edildi.');
                }
            }
        } catch (e) {
            logger.warn('[KickChat] ⚠️ Could not update .env file:', e.message);
        }

        logger.log(`[KickChat] ✅ Token refreshed! Expires in ${data.expires_in}s`);
        return true;
    } catch (err) {
        logger.error(`[KickChat] ❌ Token refresh error: ${err.message}`);
        return false;
    }
}

// Proactive token refresh every 90 minutes (token expires in 2h)
let tokenRefreshTimer = null;
function startTokenRefreshTimer() {
    if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
    tokenRefreshTimer = setInterval(refreshOAuthToken, 90 * 60 * 1000);
    logger.log('[KickChat] ⏰ Token auto-refresh scheduled (every 90 min)');
}

/**
 * Kick resmi API'si ile sohbete mesaj gönderir.
 * 401/403 alırsa token'ı otomatik yeniler ve tekrar dener.
 */
async function sendMessage(roomId, message) {
    let token = process.env.KICK_OAUTH_TOKEN;

    if (!token) {
        logger.warn(`[KickChat] ⚠️ KICK_OAUTH_TOKEN not set. Message not sent: "${message}"`);
        return false;
    }

    if (!broadcasterUserId) {
        logger.warn(`[KickChat] ⚠️ Broadcaster User ID not available. Message not sent: "${message}"`);
        return false;
    }

    async function attemptSend(authToken) {
        logger.log(`[KickChat] 📤 Sending message to broadcaster ${broadcasterUserId}...`);
        return await fetch('https://api.kick.com/public/v1/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                broadcaster_user_id: broadcasterUserId,
                content: message,
                type: 'user'
            }),
            signal: AbortSignal.timeout(10000)
        });
    }

    try {
        let res = await attemptSend(token);

        // If 401/403, try refreshing token and retry once
        if (res.status === 401 || res.status === 403) {
            logger.warn('[KickChat] ⚠️ Token expired, attempting auto-refresh...');
            const refreshed = await refreshOAuthToken();
            if (refreshed) {
                token = process.env.KICK_OAUTH_TOKEN;
                res = await attemptSend(token);
            } else {
                logger.error('[KickChat] ❌ Auto-refresh failed. Message not sent.');
                return false;
            }
        }

        if (res.ok) {
            logger.log(`[KickChat] ✅ Message sent: "${message.substring(0, 50)}..."`);
            return true;
        } else {
            const errorText = await res.text().catch(() => 'Unknown');
            logger.error(`[KickChat] ❌ Send failed (${res.status}): ${errorText}`);
            return false;
        }
    } catch (err) {
        logger.error(`[KickChat] ❌ Send error: ${err.message}`);
        return false;
    }
}

// ============================================================
// TIMERS (Zamanlanmış Mesajlar)
// ============================================================

/**
 * Yayın durumunu storage'dan kontrol eder.
 * streamManager zaten periyodik olarak Kick API'yi kontrol edip storage'a yazıyor.
 */
function checkStreamStatus() {
    try {
        const channelName = config.channelName || process.env.KICK_CHANNEL_NAME || 'sevolololo';
        const state = storage.getStreamState('kick', channelName);
        const wasLive = isStreamLive;
        isStreamLive = state.lastStatus === 'online';

        if (wasLive !== isStreamLive) {
            logger.log(`[KickChat] 🔍 Stream durumu değişti: ${wasLive ? 'LIVE' : 'OFFLINE'} → ${isStreamLive ? 'LIVE' : 'OFFLINE'}`);
        }
    } catch (err) {
        logger.warn(`[KickChat] ⚠️ Stream durumu kontrol hatası: ${err.message}`);
    }
}

/**
 * Timer mesajını yayın durumuna göre gönderir.
 * - Yayın AÇIK: Normal aralıkla gönderir
 * - Yayın KAPALI: 12 saatte en fazla 1 kez gönderir
 */
function sendTimerMessage(roomId, timer) {
    // Yayın durumunu güncelle
    checkStreamStatus();

    if (isStreamLive) {
        // Yayın açık — normal gönder
        stats.timerMessagesSent++;
        logger.log(`[KickChat] ⏰ Timer "${timer.id}" fired (stream LIVE)`);
        sendMessage(roomId, timer.message);
    } else {
        // Yayın kapalı — 12 saat kontrolü
        const now = Date.now();
        const lastSent = lastOfflineTimerSent[timer.id] || 0;
        const elapsed = now - lastSent;

        if (elapsed >= OFFLINE_INTERVAL_MS) {
            stats.timerMessagesSent++;
            lastOfflineTimerSent[timer.id] = now;
            logger.log(`[KickChat] ⏰ Timer "${timer.id}" fired (stream OFFLINE, 12h cooldown reset)`);
            sendMessage(roomId, timer.message);
        } else {
            const remainingH = ((OFFLINE_INTERVAL_MS - elapsed) / (1000 * 60 * 60)).toFixed(1);
            logger.log(`[KickChat] ⏰ Timer "${timer.id}" skipped (stream OFFLINE, ${remainingH}h kaldı)`);
        }
    }
}

function startTimers(roomId) {
    stopTimers(); // Clear any existing timers first

    const timers = config.timers || [];
    const enabledTimers = timers.filter(t => t.enabled);

    if (enabledTimers.length === 0) {
        logger.log('[KickChat] No enabled timers found.');
        return;
    }

    // İlk yayın durumu kontrolü
    checkStreamStatus();
    logger.log(`[KickChat] 🔍 İlk stream durumu: ${isStreamLive ? 'LIVE ✅' : 'OFFLINE 🔴'}`);

    // Periyodik yayın durumu kontrolü (her 60 saniye)
    if (streamCheckTimer) clearInterval(streamCheckTimer);
    streamCheckTimer = setInterval(checkStreamStatus, 60 * 1000);

    for (const timer of enabledTimers) {
        const intervalMs = (timer.intervalMinutes || 15) * 60 * 1000;

        logger.log(`[KickChat] ⏰ Timer "${timer.id}" started: every ${timer.intervalMinutes} min (stream-aware)`);

        // Fire once after 5 seconds (to allow connection to establish), then repeat
        const initialTimeout = setTimeout(() => {
            sendTimerMessage(roomId, timer);
        }, 5000);

        const handle = setInterval(() => {
            sendTimerMessage(roomId, timer);
        }, intervalMs);

        activeTimers.push({ id: timer.id, handle, initialTimeout });
    }

    logger.log(`[KickChat] ${activeTimers.length} timer(s) active (stream-aware mode).`);
}

function stopTimers() {
    for (const timer of activeTimers) {
        clearInterval(timer.handle);
        if (timer.initialTimeout) clearTimeout(timer.initialTimeout);
    }
    if (activeTimers.length > 0) {
        logger.log(`[KickChat] ${activeTimers.length} timer(s) stopped.`);
    }
    activeTimers = [];
    if (streamCheckTimer) {
        clearInterval(streamCheckTimer);
        streamCheckTimer = null;
    }
}

// Watch config file for timer changes (every 30s)
let lastTimerConfigHash = '';
let configWatcherHandle = null;

function startConfigWatcher(roomId) {
    // Store initial hash
    lastTimerConfigHash = JSON.stringify(config.timers || []);

    configWatcherHandle = setInterval(() => {
        try {
            const freshConfig = loadConfig();
            const freshHash = JSON.stringify(freshConfig.timers || []);

            if (freshHash !== lastTimerConfigHash) {
                logger.log('[KickChat] 🔄 Timer config changed — restarting timers...');
                config = freshConfig;
                lastTimerConfigHash = freshHash;
                stopTimers();
                startTimers(roomId);
            }
        } catch (e) {
            // Silent fail
        }
    }, 30000); // Check every 30 seconds
}

function stopConfigWatcher() {
    if (configWatcherHandle) {
        clearInterval(configWatcherHandle);
        configWatcherHandle = null;
    }
}

// ============================================================
// STATUS & DIAGNOSTICS
// ============================================================

function getStatus() {
    const statusObj = {
        initialized: isInitialized,
        channelName: config.channelName,
        chatroomId: chatroomId,
        connected: pusherClient?.connection?.state === 'connected',
        connectionState: pusherClient?.connection?.state || 'not_started',
        activeTimers: activeTimers.map(t => t.id),
        stats: { ...stats },
        hasOAuthToken: !!process.env.KICK_OAUTH_TOKEN
    };

    // Write status to file for dashboard access
    writeStatusFile(statusObj);

    return statusObj;
}

function writeStatusFile(statusObj) {
    try {
        const dir = path.dirname(STATUS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATUS_PATH, JSON.stringify(statusObj, null, 2), 'utf-8');
    } catch (err) {
        // Silent fail
    }
}

// ============================================================
// INIT & SHUTDOWN
// ============================================================

/**
 * Kick Chat modülünü başlatır.
 * @param {Object|null} client - Discord.js client (opsiyonel, cross-platform bildirimler için)
 * @param {string} channelName - Kick kanal adı (slug)
 */
async function init(client, channelName) {
    if (isInitialized) {
        logger.warn('[KickChat] Already initialized. Call shutdown() first.');
        return;
    }

    discordClient = client;
    config.channelName = channelName || config.channelName;

    if (!config.channelName) {
        logger.error('[KickChat] ❌ No channel name provided. Aborting.');
        return;
    }

    logger.log(`[KickChat] 🚀 Initializing for channel: ${config.channelName}`);

    // 1. Get chatroom ID
    chatroomId = await getChatroomId(config.channelName);

    if (!chatroomId) {
        logger.error(`[KickChat] ❌ Could not resolve chatroom ID for "${config.channelName}". Will retry in 60 seconds...`);

        // Auto-retry after 60 seconds
        setTimeout(() => {
            isInitialized = false;
            init(client, channelName);
        }, 60000);
        return;
    }

    logger.log(`[KickChat] Chatroom ID: ${chatroomId}`);

    // 2. Connect to Pusher WebSocket
    connectToPusher(chatroomId);

    // 3. Start timers
    startTimers(chatroomId);

    // 3b. Watch config for timer changes (auto-reload from dashboard)
    startConfigWatcher(chatroomId);

    // 4. Start periodic chat stats save (every 30 seconds)
    if (chatStatsSaveTimer) clearInterval(chatStatsSaveTimer);
    chatStatsSaveTimer = setInterval(saveChatStats, 30000);

    // 5. Check OAuth token and start auto-refresh
    if (!process.env.KICK_OAUTH_TOKEN) {
        logger.warn('[KickChat] ⚠️ KICK_OAUTH_TOKEN not set. Running in LISTEN-ONLY mode.');
        logger.warn('[KickChat] ⚠️ Commands and timers will log but NOT send messages to Kick chat.');
        logger.warn('[KickChat] ⚠️ Set KICK_OAUTH_TOKEN in .env to enable message sending.');
    } else {
        logger.log('[KickChat] ✅ OAuth token found. Message sending ENABLED.');
        startTokenRefreshTimer();
    }

    isInitialized = true;
    logger.log('[KickChat] ✅ Kick Chat Manager initialized successfully!');
}

/**
 * Modülü durdurur ve kaynakları temizler.
 */
function shutdown() {
    logger.log('[KickChat] Shutting down...');
    stopTimers();
    stopConfigWatcher();
    if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
    disconnectPusher();
    saveChatStats();
    if (chatStatsSaveTimer) clearInterval(chatStatsSaveTimer);
    chatroomId = null;
    isInitialized = false;
    logger.log('[KickChat] Shutdown complete.');
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    init,
    shutdown,
    getConfig,
    updateConfig,
    getStatus,
    getChatStats,
    resetChatStats,
    sendMessage: (message) => {
        if (chatroomId) return sendMessage(chatroomId, message);
        logger.warn('[KickChat] Cannot send message: not initialized.');
        return Promise.resolve(false);
    }
};
