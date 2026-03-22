/**
 * Puppeteer Helper — Ortak Puppeteer altyapısı
 * 
 * Tüm Puppeteer kullanımlarını merkezi olarak yönetir:
 * - Sabit profil dizini (Temp yerine proje içi puppeteer_data/)
 * - Startup cleanup (eski temp profilleri temizler)
 * - Resource interception (resim, CSS, font yüklenmesini engeller)
 * - Guaranteed browser.close() (try/catch/finally)
 * - Singleton browser instance
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('./logger');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// --- Sabit profil dizini (proje kökünde, Temp değil) ---
// Her PM2 process kendi alt klasörünü kullanır (iki bot aynı profili paylaşamaz)
const processName = process.env.name || process.env.pm_id || `pid_${process.pid}`;
const PROFILE_DIR = path.join(__dirname, '..', 'puppeteer_data', processName);

// Singleton browser instance
let browserInstance = null;
let isLaunching = false;

// ============================================================
// STARTUP CLEANUP — Temp'teki eski puppeteer profilleri
// ============================================================

/**
 * Temp klasöründeki eski puppeteer_sevobot_* profillerini temizler.
 * Asenkron (non-blocking) çalışır, botun başlamasını geciktirmez.
 */
function cleanupOldProfiles() {
    const tempDir = os.tmpdir();
    logger.log('[Puppeteer] 🧹 Eski temp profilleri arka planda taranıyor...');

    // Asenkron işlemi hemen başlatıp dön (await etmiyoruz)
    (async () => {
        let found = 0;
        let cleaned = 0;
        let skipped = 0;
        const fsPromises = require('fs').promises;

        try {
            const entries = await fsPromises.readdir(tempDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (!entry.name.startsWith('puppeteer_sevobot') && !entry.name.startsWith('puppeteer_dev_profile')) continue;

                found++;
                const fullPath = path.join(tempDir, entry.name);

                try {
                    await fsPromises.rm(fullPath, { recursive: true, force: true });
                    cleaned++;
                } catch (err) {
                    // Klasör kilitli — sessizce skip et
                    skipped++;
                }

                // CPU ve Event Loop'u kilitlememek için arada bir diğer işlemlere nefes aldır
                if (found % 100 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            if (found === 0) {
                logger.log('[Puppeteer] ✅ Temizlenecek eski profil bulunamadı.');
            } else {
                logger.log(`[Puppeteer] 🧹 Temizlik tamamlandı: ${found} bulundu, ${cleaned} silindi, ${skipped} atlandı (kilitli/EPERM)`);
            }
        } catch (err) {
            logger.warn(`[Puppeteer] ⚠️ Temp dizini okunamadı: ${err.message}`);
        }
    })();
}

// ============================================================
// PROFIL KLASÖRÜ
// ============================================================

/**
 * Sabit profil klasörünü oluşturur. Zaten varsa bir şey yapmaz.
 */
function ensureProfileDir() {
    try {
        if (!fs.existsSync(PROFILE_DIR)) {
            fs.mkdirSync(PROFILE_DIR, { recursive: true });
            logger.log(`[Puppeteer] 📁 Profil dizini oluşturuldu: ${PROFILE_DIR}`);
        }
    } catch (err) {
        logger.error(`[Puppeteer] ❌ Profil dizini oluşturulamadı: ${err.message}`);
        throw err;
    }
}

// ============================================================
// BROWSER MANAGEMENT
// ============================================================

const LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--window-size=1280,720'
];

/**
 * Singleton browser instance döndürür.
 * Hâlâ bağlıysa mevcut instance'ı kullanır, değilse yeni başlatır.
 */
async function getBrowser() {
    if (browserInstance && browserInstance.connected) return browserInstance;

    if (isLaunching) {
        // Başka bir çağrı zaten launch yapıyor, bekle
        await new Promise(r => setTimeout(r, 2000));
        return getBrowser();
    }

    isLaunching = true;
    try {
        ensureProfileDir();

        logger.log('[Puppeteer] 🌐 Stealth Browser başlatılıyor...');
        browserInstance = await puppeteer.launch({
            headless: 'new',
            userDataDir: PROFILE_DIR,
            args: LAUNCH_ARGS
        });

        logger.log('[Puppeteer] ✅ Stealth Browser hazır.');
        return browserInstance;
    } catch (err) {
        // Lock dosyası kalmışsa temizle ve tekrar dene
        if (err.message && err.message.includes('already running')) {
            logger.warn('[Puppeteer] ⚠️ Lock dosyası algılandı. Temizleyip tekrar deniyorum...');
            try {
                const lockFile = path.join(PROFILE_DIR, 'SingletonLock');
                if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

                browserInstance = await puppeteer.launch({
                    headless: 'new',
                    userDataDir: PROFILE_DIR,
                    args: LAUNCH_ARGS
                });
                logger.log('[Puppeteer] ✅ Stealth Browser hazır (lock temizliği sonrası).');
                return browserInstance;
            } catch (retryErr) {
                logger.error('[Puppeteer] ❌ Lock temizliğinden sonra da başlatılamadı:', retryErr.message);
                return null;
            }
        }
        logger.error('[Puppeteer] ❌ Browser başlatılamadı:', err.message);
        return null;
    } finally {
        isLaunching = false;
    }
}

/**
 * Browser instance'ı kapatır.
 */
async function closeBrowser() {
    if (browserInstance) {
        try {
            await browserInstance.close();
            logger.log('[Puppeteer] Browser kapatıldı.');
        } catch (err) {
            logger.warn(`[Puppeteer] ⚠️ Browser kapatma hatası: ${err.message}`);
        } finally {
            browserInstance = null;
        }
    }
}

// ============================================================
// RESOURCE INTERCEPTION
// ============================================================

/**
 * Bir sayfada gereksiz kaynak yüklemelerini engeller.
 * Resim, CSS, font dosyaları yüklenmez → RAM ve disk tasarrufu.
 */
async function enableResourceBlocking(page) {
    try {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
    } catch (err) {
        logger.warn(`[Puppeteer] ⚠️ Resource interception aktifleştirilemedi: ${err.message}`);
    }
}

// ============================================================
// HIGH-LEVEL HELPERS
// ============================================================

/**
 * Yeni bir sayfa oluşturur, resource blocking aktifleştirir.
 * @returns {Promise<{browser: object, page: object}|null>}
 */
async function createPage() {
    const browser = await getBrowser();
    if (!browser) return null;

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await enableResourceBlocking(page);

    return { browser, page };
}

/**
 * Tek seferlik Puppeteer işlemi çalıştırır.
 * Her işlem kendi browser instance'ını açar ve guarantee olarak kapatır.
 * Singleton yerine izole kullanım gereken durumlar için (ör: VoD download).
 * 
 * @param {function(browser, page): Promise<any>} fn - Çalıştırılacak async fonksiyon
 * @returns {Promise<any>} fn'in dönüş değeri
 */
async function withIsolatedBrowser(fn) {
    let browser = null;
    let page = null;

    try {
        ensureProfileDir();

        // İzole profil — singleton ile çakışmasın
        const isolatedDir = path.join(PROFILE_DIR, `isolated_${Date.now()}`);
        fs.mkdirSync(isolatedDir, { recursive: true });

        browser = await puppeteer.launch({
            headless: 'new',
            userDataDir: isolatedDir,
            args: LAUNCH_ARGS
        });

        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await enableResourceBlocking(page);

        const result = await fn(browser, page);
        return result;
    } catch (err) {
        logger.error(`[Puppeteer] ❌ withIsolatedBrowser hata: ${err.message}`);
        throw err;
    } finally {
        // Her ne olursa olsun browser kapatılır
        if (browser) {
            try {
                await browser.close();
            } catch (closeErr) {
                logger.warn(`[Puppeteer] ⚠️ Browser kapanma hatası: ${closeErr.message}`);
            }
        }
    }
}

module.exports = {
    cleanupOldProfiles,
    getBrowser,
    closeBrowser,
    createPage,
    enableResourceBlocking,
    withIsolatedBrowser,
    PROFILE_DIR
};
