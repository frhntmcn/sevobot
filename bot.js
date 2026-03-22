// Standalone Discord Bot Entry Point
// Use this file when deploying to a Background Worker (e.g., Render, Railway, VPS)
// that is separate from your Next.js website.

const fs = require('fs');
const path = require('path');
const { startDiscordBot } = require('./services/discordBot');
require('dotenv').config();

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

// Check for token
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("ERROR: DISCORD_TOKEN is missing from environment variables.");
  console.error("If running locally, make sure to set the variable.");
  console.error("If on Render/Railway, add it to the Environment Variables settings.");
  process.exit(1);
}

// Startup cleanup — Temp'teki eski Puppeteer profillerini temizle
try {
  const { cleanupOldProfiles } = require('./services/puppeteerHelper');
  cleanupOldProfiles();
} catch (err) {
  console.warn("⚠️ Puppeteer cleanup atlandı:", err.message);
}

console.log("Starting Discord Bot in standalone mode...");
startDiscordBot(token);

// Keep-alive server — Render/UptimeRobot uyumluluğu için
// NOT: PORT=3000 dashboard (server.js/sevobotKick) tarafından kullanılır.
// Bu keep-alive server farklı bir port kullanmalı.
const http = require('http');
const keepAlivePort = 8080;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('Discord Bot is Alive!');
  res.end();
}).listen(keepAlivePort, () => {
  console.log(`Keep-alive server listening on port ${keepAlivePort}`);
});
