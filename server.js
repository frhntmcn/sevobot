// dotenv en başta yüklenmeli — diğer modüller env değişkenlerine bağımlı
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ============================================================
// .env KORUMASI — Boş dosya crash loop'u engellenir
// ============================================================
const envPath = path.join(__dirname, '.env');
try {
    const envContent = fs.readFileSync(envPath, 'utf-8').trim();
    if (envContent.length === 0) {
        console.error("═══════════════════════════════════════════════════");
        console.error("  FATAL: .env dosyası tamamen boş!");
        console.error("  Bot başlatılamaz. Lütfen .env dosyasını doldurun.");
        console.error("  PM2 sonsuz restart yapmasın diye process çıkıyor.");
        console.error("═══════════════════════════════════════════════════");
        process.exit(1);
    }
} catch (err) {
    console.error("FATAL: .env dosyası okunamadı:", err.message);
    process.exit(1);
}

// Startup cleanup — Temp'teki eski Puppeteer profillerini temizle
try {
    const { cleanupOldProfiles } = require('./services/puppeteerHelper');
    cleanupOldProfiles();
} catch (err) {
    console.warn("⚠️ Puppeteer cleanup atlandı:", err.message);
}

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { startDiscordBot } = require('./services/discordBot');
const kickChatManager = require('./services/kickChatManager');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;

// Start Kick Chat Manager immediately (doesn't need Next.js or port)
function startKickChat() {
    const KICK_CHANNEL = process.env.KICK_CHANNEL_NAME;
    if (KICK_CHANNEL) {
        kickChatManager.init(null, KICK_CHANNEL);
    } else {
        console.warn("WARNING: KICK_CHANNEL_NAME is not defined. Kick Chat module will not start.");
    }
}

// Start Discord Bot
function startDiscord() {
    const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
    if (DISCORD_TOKEN) {
        startDiscordBot(DISCORD_TOKEN);
    } else {
        console.warn("WARNING: DISCORD_TOKEN is not defined. Discord Bot will not start.");
    }
}

// Start Kick Chat and Discord immediately — they don't depend on Next.js
startKickChat();
startDiscord();

// Start Next.js server separately — if port is busy, log warning but don't crash
app.prepare().then(() => {
    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`⚠️ Port ${port} is already in use. Dashboard will not be available.`);
            console.error(`⚠️ Kick Chat and Discord Bot will continue running without the web dashboard.`);
            // Don't crash — KickChat and Discord are already running
        } else {
            console.error('Server error:', err);
        }
    });

    server.listen(port, () => {
        console.log(`> Ready on http://localhost:${port}`);
    });
}).catch((err) => {
    console.error('Next.js prepare failed:', err);
    console.error('Kick Chat and Discord Bot will continue without dashboard.');
});
