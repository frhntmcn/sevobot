const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { startDiscordBot } = require('./services/discordBot');

// Load environment variables if strictly needed, but Next.js loads .env automatically for `process.env`.
// However, since we are using a custom server, we might need 'dotenv' if we aren't careful, 
// but Next.js usually handles loading .env.local into process.env before the app prepares? 
// Actually, Next.js built-in env loading happens during `next dev` or `next start`. 
// When running `node server.js`, we might need `dotenv` to load local vars for development 
// unless we rely on Next.js to load them after app.prepare(). 
// But the bot starts *after* app.prepare() usually to be safe.

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;

app.prepare().then(() => {
    createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    }).listen(port, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${port}`);

        // Start Discord Bot after server is ready
        // Make sure DISCORD_TOKEN is in your .env or .env.local file
        const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
        if (DISCORD_TOKEN) {
            startDiscordBot(DISCORD_TOKEN);
        } else {
            console.warn("WARNING: DISCORD_TOKEN is not defined in environment variables. Discord Bot will not start.");
        }
    });
});
