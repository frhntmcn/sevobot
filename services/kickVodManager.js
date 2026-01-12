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
 * Sniffs the M3U8 URL by intercepting the internal API call the Kick frontend makes.
 * This is more reliable than waiting for the video to play.
 * @param {string} channelSlug 
 * @returns {Promise<{m3u8: string, date: string, id: string}>}
 */
async function getLatestVodM3u8(channelSlug) {
    logger.log(`VERSION: 4.0 (API Intercept)`);
    logger.log(`🕵️ [KickVOD] Sniffing Metadata for ${channelSlug}...`);
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

        // 1. Get Channel Info to find latest video UUID
        logger.log(`⏳ [KickVOD] Fetching channel data...`);
        await page.goto(`https://kick.com/api/v1/channels/${channelSlug}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        const content = await page.evaluate(() => document.body.innerText);
        let data;
        try {
            data = JSON.parse(content);
        } catch (e) {
            throw new Error("Failed to parse channel API JSON.");
        }

        if (!data || !data.previous_livestreams || data.previous_livestreams.length === 0) {
            throw new Error("No previous livestreams found.");
        }

        const latestVod = data.previous_livestreams[0];
        const videoSlug = latestVod.video.uuid;
        const uploadDate = new Date(latestVod.created_at).toISOString().split('T')[0].replace(/-/g, '');
        const videoId = latestVod.id;

        logger.log(`✅ [KickVOD] Found latest VOD UUID: ${videoSlug}`);

        // 2. Go to Video Page and INTERCEPT the metadata API request
        // We don't need the video to play, we just need the frontend to fetch the video data.
        const videoUrl = `https://kick.com/video/${videoSlug}`;
        logger.log(`running [KickVOD] Navigating to ${videoUrl} to intercept metadata...`);

        // We set up a race: strict timeout vs found response
        const [response] = await Promise.all([
            page.waitForResponse(res => res.url().includes(`/api/v1/video/${videoSlug}`) && res.status() === 200, { timeout: 30000 }).catch(() => null),
            page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
        ]);

        if (!response) {
            // Check fallback: sometimes fetching page is faster than listener setup (unlikely with await all)
            // Or maybe it uses v2?
            throw new Error("Timeout waiting for metadata API response.");
        }

        const videoData = await response.json();
        const m3u8Url = videoData.source;

        if (!m3u8Url) {
            throw new Error("Metadata received but 'source' (m3u8) field is missing.");
        }

        logger.log(`🎯 [KickVOD] Captured M3U8 from API: ${m3u8Url}`);
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
            logger.error(`❌ [KickVOD] Sniffing Error: ${err.message}`);
            return reject(err);
        }

        const { m3u8, date, id } = vodInfo;
        const fileName = `${channelSlug}_${date}_${id}.mp4`;
        const outputPath = path.join(TEMP_DIR, fileName);

        // Determine Python Path
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

        // Generic yt-dlp command for generic m3u8. Bypasses Kick extractor.
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
