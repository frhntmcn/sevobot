// Standalone Discord Bot Entry Point
// Use this file when deploying to a Background Worker (e.g., Render, Railway, VPS)
// that is separate from your Next.js website.

const { startDiscordBot } = require('./services/discordBot');
require('dotenv').config();

// Check for token
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("ERROR: DISCORD_TOKEN is missing from environment variables.");
  console.error("If running locally, make sure to set the variable.");
  console.error("If on Render/Railway, add it to the Environment Variables settings.");
  process.exit(1);
}

console.log("Starting Discord Bot in standalone mode...");
startDiscordBot(token);

// Keep-alive server for Render Web Service (Free Tier) compatibility
// This prevents the app from crashing because Render Web Services expect a port to be bound.
// You must also use an uptime monitor (like UptimeRobot) to ping the URL every 5 minutes 
// to prevent the free instance from spinning down (sleeping).
const http = require('http');
const port = process.env.PORT || 8080;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('Discord Bot is Alive!');
  res.end();
}).listen(port, () => {
  console.log(`Keep-alive server listening on port ${port}`);
});
