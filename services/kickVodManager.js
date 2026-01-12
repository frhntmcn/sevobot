const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { exec } = require('child_process');
const logger = require('./logger');

// Puppeteer imports for Cookie Bypass
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Configuration
const TEMP_DIR = path.join(__dirname, '../temp_vods');
const CREDENTIALS_PATH = path.join(__dirname, '../config/service-account.json');
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID; // Optional: Set in .env
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Launches a stealth browser to get Kick.com cookies.
 * This bypasses Cloudflare 403 errors by providing valid session cookies to yt-dlp.
 */
async function getKickCookies() {
    logger.log("🍪 [KickVOD] Launching browser to fetch cookies...");
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        // Go to Kick homepage to get base cookies.
        // We use 'domcontentloaded' because 'networkidle0' times out on dynamic sites like Kick.
        logger.log("⏳ [KickVOD] Waiting for Cloudflare/Kick...");
        await page.goto('https://kick.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Manual wait to allow Cloudflare challenge to complete
        await new Promise(r => setTimeout(r, 10000));

        // Get cookies
        const cookies = await page.cookies();

        // Format as Netscape (required by yt-dlp)
        // strict format: domain flag path secure expiration name value
        const netscapeCookies = cookies.map(c => {
            // 1. Domain Flag: TRUE if domain starts with '.', FALSE otherwise
            const domainFlag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';

            // 2. Expiration: Must be integer. Handle session cookies (-1 or undefined)
            let expiration = c.expires;
            if (!expiration || expiration < 0) {
                // Set to 1 year in future for session cookies to ensure they are accepted
                expiration = Math.floor(Date.now() / 1000) + 31536000;
            } else {
                expiration = Math.floor(expiration);
            }

            return `${c.domain}\t${domainFlag}\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${expiration}\t${c.name}\t${c.value}`;
        }).join('\n');

        const cookiePath = path.join(TEMP_DIR, `cookies_${Date.now()}.txt`);
        fs.writeFileSync(cookiePath, '# Netscape HTTP Cookie File\n' + netscapeCookies);

        logger.log("✅ [KickVOD] Cookies acquired and saved.");
        return cookiePath;

    } catch (error) {
        logger.error(`❌ [KickVOD] Failed to get cookies: ${error.message}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Downloads the latest VOD for a Kick channel.
 * @param {string} channelSlug 
 * @returns {Promise<string>} Path to the downloaded file
 */
async function downloadVod(channelSlug) {
    return new Promise(async (resolve, reject) => {
        logger.log(`📥 [KickVOD] Starting download for ${channelSlug}...`);

        // 1. Get Cookies
        const cookieFile = await getKickCookies();
        if (!cookieFile) {
            return reject(new Error("Could not fetch cookies for Cloudflare bypass."));
        }

        // Output template: channel_date_id.mp4
        const outputTemplate = path.join(TEMP_DIR, `${channelSlug}_%(upload_date)s_%(id)s.%(ext)s`);

        // Determine Python Executable Path (Robust Logic)
        let pythonPath = 'python';
        const possiblePaths = [
            'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
            'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
            process.env.PYTHON_PATH
        ];

        for (const p of possiblePaths) {
            if (p && fs.existsSync(p)) {
                pythonPath = `"${p}"`;
                break;
            }
        }

        // Command: Use cookies file AND matching User Agent
        const command = `${pythonPath} -m yt_dlp "https://kick.com/${channelSlug}/videos" --playlist-end 1 -o "${outputTemplate}" --format "bestvideo+bestaudio/best" --merge-output-format mp4 --cookies "${cookieFile}" --user-agent "${USER_AGENT}"`;

        logger.log(`DEBUG: Running command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            // Cleanup cookie file regardless of success
            if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile);

            if (error) {
                logger.error(`❌ [KickVOD] Download failed: ${stderr}`);
                return reject(error);
            }

            const match = stdout.match(/Destination: (.+)/);
            if (match && match[1]) {
                logger.log(`✅ [KickVOD] Download complete: ${match[1]}`);
                resolve(match[1]);
            } else {
                // Fallback check
                const files = fs.readdirSync(TEMP_DIR)
                    .filter(f => f.startsWith(channelSlug) && f.endsWith('.mp4'))
                    .sort((a, b) => fs.statSync(path.join(TEMP_DIR, b)).mtime.getTime() - fs.statSync(path.join(TEMP_DIR, a)).mtime.getTime());

                if (files.length > 0) {
                    const foundPath = path.join(TEMP_DIR, files[0]);
                    logger.log(`✅ [KickVOD] Found downloaded file: ${foundPath}`);
                    resolve(foundPath);
                } else {
                    reject(new Error("File downloaded but not found in temp dir."));
                }
            }
        });
    });
}

/**
 * Uploads a file to Google Drive.
 * @param {string} filePath 
 * @returns {Promise<void>}
 */
async function uploadToDrive(filePath) {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        logger.error("❌ [KickVOD] Google Drive credentials not found at " + CREDENTIALS_PATH);
        return;
    }

    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });

        const drive = google.drive({ version: 'v3', auth });
        const fileName = path.basename(filePath);

        logger.log(`☁️ [KickVOD] Uploading ${fileName} to Google Drive...`);

        const fileMetadata = {
            name: fileName,
            parents: FOLDER_ID ? [FOLDER_ID] : [],
        };

        const media = {
            mimeType: 'video/mp4',
            body: fs.createReadStream(filePath),
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id',
        });

        logger.log(`✅ [KickVOD] Upload success. File ID: ${response.data.id}`);
        return response.data.id;

    } catch (error) {
        logger.error(`❌ [KickVOD] Upload failed: ${error.message}`);
        throw error;
    }
}

/**
 * Orchestrates the VOD process.
 * @param {string} channelSlug 
 */
async function processVod(channelSlug) {
    try {
        // 1. Download
        const filePath = await downloadVod(channelSlug);

        // 2. Upload
        await uploadToDrive(filePath);

        // 3. Cleanup
        fs.unlinkSync(filePath);
        logger.log(`🗑️ [KickVOD] Local file deleted: ${filePath}`);

    } catch (error) {
        logger.error(`❌ [KickVOD] Process failed for ${channelSlug}: ${error.message}`);
        throw error; // Rethrow for command handler
    }
}

module.exports = { processVod };
