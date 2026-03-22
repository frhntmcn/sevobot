/**
 * Kick OAuth Token Kurulum Scripti
 * 
 * Bu script, Kick API için OAuth token almanı sağlar.
 * Tarayıcı açılır → Kick'te giriş yaparsın → Token otomatik alınır → .env'e yazılır.
 * 
 * Kullanım: node kick-oauth-setup.js
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '01KJTEWBQNNYK86CX19K7CVRNR';
const CLIENT_SECRET = '9a4ee6060a438a4e1f82aa943fbd8ec7600fd89e29f4bee78e4d7b5810ff5950';
const REDIRECT_URI = 'http://localhost:9999/callback';
const SCOPES = 'user:read channel:read chat:write chat:read';

// PKCE code verifier & challenge
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:9999`);

    if (url.pathname === '/') {
        // Redirect to Kick authorization
        const authUrl = new URL('https://id.kick.com/oauth/authorize');
        authUrl.searchParams.set('client_id', CLIENT_ID);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        authUrl.searchParams.set('scope', SCOPES);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        res.writeHead(302, { Location: authUrl.toString() });
        res.end();
        return;
    }

    if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h1>❌ Hata</h1><p>${error}: ${url.searchParams.get('error_description')}</p>`);
            setTimeout(() => process.exit(1), 1000);
            return;
        }

        if (returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>❌ State mismatch</h1>');
            setTimeout(() => process.exit(1), 1000);
            return;
        }

        // Exchange code for tokens
        try {
            console.log('[OAuth] Authorization code alindi, token ile degistiriliyor...');
            const tokenRes = await fetch('https://id.kick.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    code: code,
                    redirect_uri: REDIRECT_URI,
                    code_verifier: codeVerifier
                })
            });

            if (!tokenRes.ok) {
                const errText = await tokenRes.text();
                console.error(`[OAuth] Token istegi basarisiz (${tokenRes.status}):`, errText);
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<h1>❌ Token Hatasi</h1><pre>${errText}</pre>`);
                setTimeout(() => process.exit(1), 1000);
                return;
            }

            const data = await tokenRes.json();
            console.log('[OAuth] ✅ Token alindi!');
            console.log(`  access_token: ${data.access_token?.substring(0, 20)}...`);
            console.log(`  refresh_token: ${data.refresh_token?.substring(0, 20)}...`);
            console.log(`  expires_in: ${data.expires_in}s`);

            // Update .env file
            const envPath = path.join(__dirname, '.env');
            let envContent = fs.readFileSync(envPath, 'utf-8');

            if (envContent.includes('KICK_OAUTH_TOKEN=')) {
                envContent = envContent.replace(/KICK_OAUTH_TOKEN=.*/g, `KICK_OAUTH_TOKEN=${data.access_token}`);
            } else {
                envContent += `\nKICK_OAUTH_TOKEN=${data.access_token}`;
            }

            if (envContent.includes('KICK_REFRESH_TOKEN=')) {
                envContent = envContent.replace(/KICK_REFRESH_TOKEN=.*/g, `KICK_REFRESH_TOKEN=${data.refresh_token}`);
            } else {
                envContent += `\nKICK_REFRESH_TOKEN=${data.refresh_token}`;
            }

            fs.writeFileSync(envPath, envContent, 'utf-8');
            console.log('[OAuth] ✅ .env dosyasi guncellendi!');

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <html>
                <body style="font-family: Arial; text-align: center; margin-top: 100px; background: #1a1a2e; color: #eee;">
                    <h1 style="color: #4ade80;">✅ Token Basariyla Alindi!</h1>
                    <p>access_token ve refresh_token .env dosyasina kaydedildi.</p>
                    <p style="color: #888;">Bu pencereyi kapatabilirsin.</p>
                    <p style="margin-top: 30px; color: #4ade80;">Simdi botu yeniden baslatabilirsin:<br>
                    <code style="background: #333; padding: 4px 12px; border-radius: 4px;">pm2 restart sevobot</code></p>
                </body>
                </html>
            `);

            setTimeout(() => {
                console.log('[OAuth] Script tamamlandi. Cikiliyor...');
                process.exit(0);
            }, 2000);

        } catch (err) {
            console.error('[OAuth] Hata:', err.message);
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h1>❌ Hata</h1><pre>${err.message}</pre>`);
            setTimeout(() => process.exit(1), 1000);
        }
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(9999, () => {
    console.log('');
    console.log('========================================================');
    console.log('           Kick OAuth Token Kurulumu                     ');
    console.log('========================================================');
    console.log('');
    console.log('  Tarayicinda su adresi ac:');
    console.log('  --> http://localhost:9999');
    console.log('');
    console.log('  Kick hesabinla giris yap ve izin ver.');
    console.log('  Token otomatik olarak .env dosyasina kaydedilecek.');
    console.log('');
    console.log('========================================================');
    console.log('');
});
