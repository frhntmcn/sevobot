const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { exec } = require('child_process');
const logger = require('./logger');
const puppeteerHelper = require('./puppeteerHelper');

// Configuration
const TEMP_DIR = path.join(__dirname, '../temp_vods');
const CREDENTIALS_PATH = path.join(__dirname, '../config/service-account.json');
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID; // Optional: Set in .env
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Global Lock for Channel Slugs
const activeDownloads = new Set();

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Sniffs the M3U8 URL by intercepting the internal API call the Kick frontend makes.
 * Uses withIsolatedBrowser for guaranteed browser.close().
 * @param {string} channelSlug 
 * @returns {Promise<{m3u8: string, date: string, id: string}>}
 */
async function getLatestVodM3u8(channelSlug) {
    logger.log(`VERSION: 5.0 (puppeteerHelper)`);
    logger.log(`🕵️ [KickVOD] Sniffing Metadata for ${channelSlug}...`);

    return await puppeteerHelper.withIsolatedBrowser(async (browser, page) => {
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

        // 2. Direct API Navigation
        const videoApiUrl = `https://kick.com/api/v1/video/${videoSlug}`;
        logger.log(`running [KickVOD] Navigating directly to API: ${videoApiUrl}`);

        await page.goto(videoApiUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const videoApiContent = await page.evaluate(() => document.body.innerText);

        let videoData;
        try {
            videoData = JSON.parse(videoApiContent);
        } catch (e) {
            logger.error(`❌ [KickVOD] API returned non-JSON content. First 200 chars: ${videoApiContent.substring(0, 200)}`);
            throw new Error("Failed to parse Video API JSON. Likely blocked by Cloudflare.");
        }

        const m3u8Url = videoData.source;

        if (!m3u8Url) {
            logger.error(`❌ [KickVOD] 'source' not found in API response. Keys: ${Object.keys(videoData).join(', ')}`);
            // Check nested 'livestream' object just in case
            if (videoData.livestream && videoData.livestream.source) {
                return { m3u8: videoData.livestream.source, date: uploadDate, id: videoId };
            }
            throw new Error("Metadata API response missing 'source' URL.");
        }

        logger.log(`🎯 [KickVOD] Captured M3U8 from API: ${m3u8Url}`);
        return { m3u8: m3u8Url, date: uploadDate, id: videoId };
    });
}

/**
 * Downloads the latest VOD for a Kick channel.
 * @param {string} channelSlug 
 * @returns {Promise<{tempFilePath: string, originalFileName: string}>} Paths
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
        const originalFileName = `${channelSlug}_${date}_${id}.mp4`;
        // Unique temp filename to avoid collision if multiple processes run or zombie files exist
        const tempFileName = `${channelSlug}_${date}_${id}_${Date.now()}.mp4`;
        const outputPath = path.join(TEMP_DIR, tempFileName);

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
                resolve({ tempFilePath: outputPath, originalFileName });
            } else {
                reject(new Error("Download finished but file not found."));
            }
        });
    });
}

/**
 * Uploads a file to Google Drive.
 * @param {string} filePath 
 * @param {string|null} targetFileName Optional target filename on Drive
 * @returns {Promise<string>} File ID
 */
async function uploadToDrive(filePath, targetFileName = null) {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        const msg = `Google Drive credentials not found at ${CREDENTIALS_PATH}`;
        logger.error(`❌ [KickVOD] ${msg}`);
        throw new Error(msg); // THROW so we skip the delete step in processVod
    }

    if (!FOLDER_ID) {
        const msg = "GDRIVE_FOLDER_ID not set in environment variables.";
        logger.error(`❌ [KickVOD] ${msg}`);
        throw new Error(msg);
    }

    logger.log(`📤 [KickVOD] Uploading ${path.basename(filePath)} to Google Drive...`);

    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/drive.file']
    });

    const drive = google.drive({ version: 'v3', auth });

    try {
        const response = await drive.files.create({
            requestBody: {
                name: targetFileName || path.basename(filePath),
                parents: [FOLDER_ID]
            },
            media: {
                mimeType: 'video/mp4',
                body: fs.createReadStream(filePath)
            }
        });

        logger.log(`✅ [KickVOD] Upload successful! File ID: ${response.data.id}`);
        return response.data.id;
    } catch (uploadError) {
        logger.error(`❌ [KickVOD] Drive Upload Error: ${uploadError.message}`);
        throw uploadError;
    }
}

/**
 * Orchestrates the VOD process.
 * @param {string} channelSlug 
 */
async function processVod(channelSlug) {
    if (activeDownloads.has(channelSlug)) {
        logger.warn(`⚠️ [KickVOD] Download already in progress for ${channelSlug}. Skipping.`);
        return;
    }

    activeDownloads.add(channelSlug);
    logger.log(`🔐 [KickVOD] Lock acquired for ${channelSlug}`);

    try {
        // 1. Download (Returns object now)
        const { tempFilePath, originalFileName } = await downloadVod(channelSlug);

        // 2. Upload (Pass original filename)
        await uploadToDrive(tempFilePath, originalFileName);

        // 3. Cleanup
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            logger.log(`🗑️ [KickVOD] Local temp file deleted: ${tempFilePath}`);
        }

    } catch (error) {
        logger.error(`❌ [KickVOD] Process failed for ${channelSlug}: ${error.message}`);
        throw error; // Rethrow for command handler
    } finally {
        activeDownloads.delete(channelSlug);
        logger.log(`🔓 [KickVOD] Lock released for ${channelSlug}`);
    }
}

module.exports = { processVod };
