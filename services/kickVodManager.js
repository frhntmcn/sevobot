const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { exec } = require('child_process');
const logger = require('./logger');

// Configuration
const TEMP_DIR = path.join(__dirname, '../temp_vods');
const CREDENTIALS_PATH = path.join(__dirname, '../config/service-account.json');
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID; // Optional: Set in .env

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Downloads the latest VOD for a Kick channel.
 * @param {string} channelSlug 
 * @returns {Promise<string>} Path to the downloaded file
 */
async function downloadVod(channelSlug) {
    return new Promise((resolve, reject) => {
        logger.log(`📥 [KickVOD] Starting download for ${channelSlug}...`);

        // Output template: channel_date_id.mp4
        const outputTemplate = path.join(TEMP_DIR, `${channelSlug}_%(upload_date)s_%(id)s.%(ext)s`);

        // Command to download the latest video from the channel URL
        // Kick VOD URLs are usually kick.com/channel/videos/video_id
        // But yt-dlp can often parse the channel videos page.
        // Better strategy: ask yt-dlp to get the latest video from the channel.
        // Added --impersonate chrome to bypass Cloudflare 403 errors
        const command = `python -m yt_dlp "https://kick.com/${channelSlug}/videos" --playlist-end 1 -o "${outputTemplate}" --format "bestvideo+bestaudio/best" --merge-output-format mp4 --impersonate chrome`;

        logger.log(`DEBUG: Running command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                logger.error(`❌ [KickVOD] Download failed: ${stderr}`);
                return reject(error);
            }

            // Find the downloaded file
            // yt-dlp output might contain the filename, but let's look in the dir for the most recent file matching the pattern.
            // Or parse stdout.
            const match = stdout.match(/Destination: (.+)/);
            if (match && match[1]) {
                logger.log(`✅ [KickVOD] Download complete: ${match[1]}`);
                resolve(match[1]);
            } else {
                // Fallback: look for file in dir
                const files = fs.readdirSync(TEMP_DIR)
                    .filter(f => f.startsWith(channelSlug))
                    .map(f => path.join(TEMP_DIR, f))
                    .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());

                if (files.length > 0) {
                    logger.log(`✅ [KickVOD] Found downloaded file: ${files[0]}`);
                    resolve(files[0]);
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
    }
}

module.exports = { processVod };
