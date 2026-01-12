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
 * Sniffs the direct .m3u8 URL for the latest VOD of a channel using Puppeteer.
 * This completely bypasses yt-dlp's metadata extraction which is prone to Cloudflare blocks.
 * @param {string} channelSlug 
 * @returns {Promise<{m3u8: string, date: string, id: string}>}
 */
async function getLatestVodM3u8(channelSlug) {
    logger.log(`🕵️ [KickVOD] Sniffing M3U8 for ${channelSlug}...`);
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

        // 1. Get Channel Info via API (Puppeteer handles Cloudflare)
        // We use the API endpoint because parsing the DOM is flaky.
        logger.log(`⏳ [KickVOD] Fetching channel data...`);
        await page.goto(`https://kick.com/api/v1/channels/${channelSlug}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Parse JSON from body
        const content = await page.evaluate(() => document.body.innerText);
        let data;
        try {
            data = JSON.parse(content);
        } catch (e) {
            throw new Error("Failed to parse channel API JSON. Cloudflare might be blocking heavily.");
        }

        if (!data || !data.previous_livestreams || data.previous_livestreams.length === 0) {
            throw new Error("No previous livestreams found for this channel.");
        }

        // Get latest VOD details
        const latestVod = data.previous_livestreams[0];
        const videoSlug = latestVod.video.uuid; // or slug? usually uuid for VODs
        const uploadDate = new Date(latestVod.created_at).toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
        const videoId = latestVod.id;

        logger.log(`✅ [KickVOD] Found latest VOD: ${latestVod.session_title} (ID: ${videoId})`);

        // 2. Go to Video Page and Sniff Network
        const videoUrl = `https://kick.com/video/${videoSlug}`;
        logger.log(`running [KickVOD] Navigating to ${videoUrl} to sniff M3U8...`);

        let m3u8Url = null;

        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8') && !url.includes('images')) {
                if (!m3u8Url) {
                    m3u8Url = url;
                    logger.log(`🎯 [KickVOD] Captured M3U8: ${url}`);
                }
            }
            request.continue();
        });

        await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // --- INTERACTION LOGIC (Crucial for VDS) ---
        // 1. Check for "Start Watching" (Mature Content) button
        try {
            const startButton = await page.waitForSelector('button.variant-action', { timeout: 5000 });
            if (startButton) {
                logger.log("⚠️ [KickVOD] Found 'Start Watching' button. Clicking...");
                await startButton.click();
            }
        } catch (e) { /* Ignore if not found */ }

        // 2. Force Video Play via DOM
        try {
            logger.log("▶️ [KickVOD] Attempting to force play video...");
            await page.evaluate(() => {
                const video = document.querySelector('video');
                if (video) {
                    video.muted = true; // Autoplay requires mute usually
                    video.play();
                } else {
                    // Try clicking the big play button if it exists
                    const bigPlay = document.querySelector('button[class*="vjs-big-play-button"]');
                    if (bigPlay) bigPlay.click();
                }
            });
        } catch (e) {
            logger.warn(`⚠️ [KickVOD] Force play attempt warning: ${e.message}`);
        }

        // Wait for sniff (increased timeout)
        const startTime = Date.now();
        while (!m3u8Url && Date.now() - startTime < 30000) {
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!m3u8Url) {
            // Last ditch: check if API data had it (sometimes it does)
            if (latestVod.video && latestVod.video.url && latestVod.video.url.includes('.m3u8')) {
                logger.log("ℹ️ [KickVOD] Fallback: Used M3U8 from API data.");
                return { m3u8: latestVod.video.url, date: uploadDate, id: videoId };
            }
            throw new Error("Timeout waiting for .m3u8 request. Video did not start.");
        }

        return { m3u8: m3u8Url, date: uploadDate, id: videoId };

    } catch (error) {
        logger.error(`❌ [KickVOD] Sniffing failed: ${error.message}`);
        throw error;
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
        logger.log(`📥 [KickVOD] Process started for ${channelSlug}...`);

        let vodInfo;
        try {
            vodInfo = await getLatestVodM3u8(channelSlug);
        } catch (err) {
            return reject(err);
        }

        const { m3u8, date, id } = vodInfo;

        // Output template: channel_date_id.mp4
        const fileName = `${channelSlug}_${date}_${id}.mp4`;
        const outputPath = path.join(TEMP_DIR, fileName);

        // Determine Python Executable Path
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

        // Command: Download direct URL
        // We do NOT use --impersonate because we are downloading a direct file, not scraping.
        // We pass User-Agent just in case.
        // We use ffmpeg/native downloader via yt-dlp by getting the URL.
        const command = `${pythonPath} -m yt_dlp "${m3u8}" -o "${outputPath}" --user-agent "${USER_AGENT}"`;

        logger.log(`DEBUG: Running command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                logger.error(`❌ [KickVOD] Download failed: ${stderr}`);
                return reject(error);
            }

            if (fs.existsSync(outputPath)) {
                logger.log(`✅ [KickVOD] Download complete: ${outputPath}`);
                resolve(outputPath);
            } else {
                reject(new Error("Download finished but file not found."));
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
