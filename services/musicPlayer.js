// services/musicPlayer.js
// Discord Voice Channel Music Player — YouTube, YT Music, Spotify desteği

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    StreamType,
    entersState,
    getVoiceConnection,
} = require('@discordjs/voice');
const play = require('play-dl');
const { spawn } = require('child_process');
const { getTracks, getPreview } = require('spotify-url-info')(fetch);

// Guild başına müzik durumu
const queues = new Map();

/**
 * Guild için kuyruk objesi oluştur veya mevcut olanı döndür
 */
function getQueue(guildId) {
    if (!queues.has(guildId)) {
        queues.set(guildId, {
            songs: [],
            player: null,
            connection: null,
            textChannel: null,
            idleTimeout: null,
            currentProcess: null,
        });
    }
    return queues.get(guildId);
}

/**
 * Boşta kalma zamanlayıcısını ayarla — 2 dakika sonra kanaldan ayrıl
 */
function setIdleTimeout(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return;

    clearIdleTimeout(guildId);
    queue.idleTimeout = setTimeout(() => {
        const conn = getVoiceConnection(guildId);
        if (conn) {
            conn.destroy();
        }
        if (queue.textChannel) {
            queue.textChannel.send('⏹️ 2 dakika boyunca müzik çalınmadı, kanaldan ayrılıyorum.').catch(() => { });
        }
        queues.delete(guildId);
    }, 2 * 60 * 1000); // 2 dakika
}

function clearIdleTimeout(guildId) {
    const queue = queues.get(guildId);
    if (queue && queue.idleTimeout) {
        clearTimeout(queue.idleTimeout);
        queue.idleTimeout = null;
    }
}

/**
 * YouTube video bilgisini al
 */
async function getYouTubeVideoInfo(videoUrl) {
    try {
        const info = await play.video_info(videoUrl);
        return {
            title: info.video_details.title,
            url: info.video_details.url,
            duration: info.video_details.durationRaw,
            source: 'YouTube',
        };
    } catch (err) {
        console.error('[MusicPlayer] YouTube video bilgisi alınamadı:', err.message);
        return null;
    }
}

/**
 * Spotify track'ini YouTube'da ara ve bilgisini döndür
 */
async function getSpotifyTrackInfo(sp) {
    try {
        const searchQuery = `${sp.name} ${sp.artists.map(a => a.name).join(' ')}`;
        const searched = await play.search(searchQuery, {
            limit: 1,
            source: { youtube: 'video' },
        });
        if (searched.length === 0) return null;
        return {
            title: sp.name + ' — ' + sp.artists.map(a => a.name).join(', '),
            url: searched[0].url,
            duration: searched[0].durationRaw,
            source: 'Spotify',
        };
    } catch (err) {
        console.error('[MusicPlayer] Spotify track arama hatası:', err.message);
        return null;
    }
}

/**
 * URL'den video ID'sini çıkar (playlist linklerinde video varsa)
 */
function extractVideoId(url) {
    try {
        const parsed = new URL(url);
        return parsed.searchParams.get('v');
    } catch {
        return null;
    }
}

/**
 * URL'nin YouTube radio/mix olup olmadığını kontrol et (list=RD ile başlar)
 */
function isYouTubeRadioMix(url) {
    try {
        const parsed = new URL(url);
        const listParam = parsed.searchParams.get('list');
        return listParam && listParam.startsWith('RD');
    } catch {
        return false;
    }
}

/**
 * Spotify URL'sinden track listesi al (track, album, playlist destekler)
 * spotify-url-info paketini kullanarak API key olmadan scraping yapar
 */
async function getSpotifyTracksFromUrl(url) {
    try {
        const tracks = await getTracks(url);
        if (!tracks || tracks.length === 0) return [];

        return tracks.map(track => {
            // spotify-url-info 'artist' alanını string olarak dönüyor
            const artistName = track.artist || track.subtitle || 'Bilinmeyen Sanatçı';
            return {
                name: track.name,
                artists: [{ name: artistName }]
            };
        });
    } catch (err) {
        console.error('[MusicPlayer] spotify-url-info hatası:', err.message);
        throw err;
    }
}

/**
 * URL'nin Spotify linki olup olmadığını kontrol et
 */
function isSpotifyUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'open.spotify.com' || parsed.hostname === 'spotify.link';
    } catch {
        return false;
    }
}

/**
 * Linkten şarkı bilgilerini al — her zaman dizi döndürür
 */
async function getSongInfo(url) {
    // Önce Spotify URL mi kontrol et (play-dl'in validate'ine bırakmadan)
    if (isSpotifyUrl(url)) {
        try {
            const tracks = await getSpotifyTracksFromUrl(url);
            const songs = [];
            for (const track of tracks.slice(0, 20)) {
                const info = await getSpotifyTrackInfo(track);
                if (info) songs.push(info);
            }
            return songs;
        } catch (err) {
            console.error('[MusicPlayer] Spotify hatası:', err.message);
            return [];
        }
    }

    // YouTube URL doğrulama
    let type;
    try {
        type = await play.validate(url);
    } catch {
        type = false;
    }

    if (!type || type === false) {
        return [];
    }

    // YouTube tekil video
    if (type === 'yt_video') {
        const info = await getYouTubeVideoInfo(url);
        return info ? [info] : [];
    }

    // YouTube playlist veya radio mix
    if (type === 'yt_playlist') {
        // YouTube Radio Mix (list=RD...) — bunlar dinamik, play-dl çözemez. yt-dlp ile çözeceğiz.
        if (isYouTubeRadioMix(url)) {
            console.log('[MusicPlayer] YouTube Radio Mix algılandı. yt-dlp ile liste çekiliyor...');
            try {
                const ytdlpPath = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe';
                const ytdlpProcess = spawn(ytdlpPath, [
                    '-J', '--flat-playlist', '--playlist-end', '50', url
                ]);

                let stdoutData = '';
                ytdlpProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });

                await new Promise((resolve, reject) => {
                    ytdlpProcess.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`yt-dlp exit code ${code}`));
                    });
                });

                const mixData = JSON.parse(stdoutData.trim());
                if (mixData && mixData.entries && mixData.entries.length > 0) {
                    const songs = [];
                    for (const entry of mixData.entries.slice(0, 50)) {
                        if (entry.id && entry.title) {
                            songs.push({
                                title: entry.title,
                                url: `https://www.youtube.com/watch?v=${entry.id}`,
                                duration: entry.duration ? new Date(entry.duration * 1000).toISOString().substr(11, 8).replace(/^00:/, '') : 'Bilinmeyen',
                                source: 'YouTube (Radio Mix)'
                            });
                        }
                    }
                    console.log(`[MusicPlayer] Mix'ten ${songs.length} şarkı eklendi.`);
                    return songs;
                }
            } catch (err) {
                console.error('[MusicPlayer] Radio Mix çekme hatası:', err.message);
            }

            // yt-dlp başarısız olursa tekli video yedeği
            const videoId = extractVideoId(url);
            if (videoId) {
                console.log('[MusicPlayer] Mix yüklenemedi, tek video olarak çalınacak.');
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                const info = await getYouTubeVideoInfo(videoUrl);
                if (info) info.source = 'YouTube (Radio Mix)';
                return info ? [info] : [];
            }
            return [];
        }

        // Normal YouTube playlist — tüm playlist'i yükle (v= parametresini ignore et)
        try {
            let playlistUrl = url;
            try {
                const parsed = new URL(url);
                const listId = parsed.searchParams.get('list');
                if (listId) {
                    playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;
                }
            } catch { /* URL parse hatası, orijinal URL ile devam et */ }

            const playlist = await play.playlist_info(playlistUrl, { incomplete: true });
            const videos = await playlist.all_videos();
            const songs = [];
            for (const video of videos.slice(0, 20)) {
                songs.push({
                    title: video.title,
                    url: video.url,
                    duration: video.durationRaw,
                    source: 'YouTube Playlist',
                });
            }
            return songs;
        } catch (err) {
            console.error('[MusicPlayer] YouTube playlist hatası:', err.message);
            const videoId = extractVideoId(url);
            if (videoId) {
                console.log('[MusicPlayer] Playlist yüklenemedi, tek video olarak çalınacak.');
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                const info = await getYouTubeVideoInfo(videoUrl);
                return info ? [info] : [];
            }
            return [];
        }
    }

    return [];
}

/**
 * Kuyruktaki sonraki şarkıyı çal
 */
async function playNext(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return;

    // Kuyrukta şarkı kalmadıysa idle timeout başlat
    if (queue.songs.length === 0) {
        setIdleTimeout(guildId);
        return;
    }

    clearIdleTimeout(guildId);

    const song = queue.songs[0];

    // Önceki yt-dlp process varsa öldür
    if (queue.currentProcess) {
        try { queue.currentProcess.kill('SIGTERM'); } catch { }
        queue.currentProcess = null;
    }

    try {
        // yt-dlp tam yolunu bul
        const ytdlpPath = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe';

        console.log(`[MusicPlayer] yt-dlp başlatılıyor: ${song.url}`);
        console.log(`[MusicPlayer] yt-dlp yolu: ${ytdlpPath}`);

        // yt-dlp ile audio'yu stdout'a pipe et
        const ytdlpProcess = spawn(ytdlpPath, [
            '-f', 'bestaudio',
            '-o', '-',              // stdout'a yaz
            '--no-playlist',
            '--no-warnings',
            song.url,
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        queue.currentProcess = ytdlpProcess;

        // stdout veri takibi
        let totalBytes = 0;
        let gotFirstChunk = false;
        ytdlpProcess.stdout.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (!gotFirstChunk) {
                console.log(`[MusicPlayer] İlk audio verisi alındı: ${chunk.length} bytes`);
                gotFirstChunk = true;
            }
        });

        // stderr'den hata logla
        let stderrData = '';
        ytdlpProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
            console.log(`[MusicPlayer] yt-dlp stderr: ${data.toString().trim().slice(0, 300)}`);
        });

        ytdlpProcess.on('error', (err) => {
            console.error('[MusicPlayer] yt-dlp process SPAWN hatası:', err.message);
            if (queue.textChannel) {
                queue.textChannel.send(`❌ yt-dlp başlatılamadı: ${err.message}`).catch(() => { });
            }
        });

        // yt-dlp'nin stdout'unu AudioResource olarak kullan
        const resource = createAudioResource(ytdlpProcess.stdout, {
            inputType: StreamType.Arbitrary,
        });
        console.log(`[MusicPlayer] AudioResource oluşturuldu, readable: ${resource.readable}`);

        // Player durumunu izle
        queue.player.removeAllListeners(AudioPlayerStatus.Playing);
        queue.player.removeAllListeners(AudioPlayerStatus.Buffering);
        queue.player.removeAllListeners('stateChange');

        queue.player.on('stateChange', (oldState, newState) => {
            console.log(`[MusicPlayer] Player durumu: ${oldState.status} -> ${newState.status}`);
        });

        queue.player.play(resource);
        console.log(`[MusicPlayer] player.play() çağrıldı: ${song.title}`);

        if (queue.textChannel) {
            queue.textChannel.send(`🎵 Şimdi çalınıyor: **${song.title}** [${song.duration}] (${song.source})`).catch(() => { });
        }

        // 10 saniye sonra veri kontrolü
        setTimeout(() => {
            if (!gotFirstChunk) {
                console.error(`[MusicPlayer] UYARI: 10 saniye sonra hâlâ audio verisi yok! Total bytes: ${totalBytes}`);
                console.error(`[MusicPlayer] stderr: ${stderrData.slice(0, 500)}`);
            } else {
                console.log(`[MusicPlayer] 10s check - Total bytes: ${totalBytes}`);
            }
        }, 10000);

        ytdlpProcess.on('close', (code) => {
            console.log(`[MusicPlayer] yt-dlp process kapandı. Kod: ${code}, Toplam bytes: ${totalBytes}`);
            if (code !== 0 && code !== null) {
                console.error(`[MusicPlayer] yt-dlp HATA çıkış kodu: ${code}`);
                if (stderrData) console.error(`[MusicPlayer] yt-dlp stderr: ${stderrData.slice(0, 500)}`);
            }
            queue.currentProcess = null;
        });
    } catch (error) {
        console.error('[MusicPlayer] Şarkı çalınırken hata:', error.message);
        console.error('[MusicPlayer] Stack:', error.stack);
        if (queue.textChannel) {
            queue.textChannel.send(`❌ Şarkı çalınamadı: **${song.title}** — ${error.message}`).catch(() => { });
        }
        // Hatalı şarkıyı kuyruktan çıkar ve sonrakine geç
        queue.songs.shift();
        await playNext(guildId);
    }
}

/**
 * !play komutu handler
 */
async function handlePlayCommand(message) {
    // Kullanıcı sesli kanalda mı?
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply('❌ Önce bir sesli kanala katılmalısın!');
    }

    // Bot izinlerini kontrol et
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return message.reply('❌ Sesli kanala katılma veya konuşma iznim yok!');
    }

    // Linkten URL'yi çıkar
    const args = message.content.split(' ').slice(1);
    const url = args[0];

    if (!url) {
        return message.reply('❌ Kullanım: `!play <YouTube/YTMusic/Spotify linki>`');
    }

    // "Yükleniyor" mesajı
    const loadingMsg = await message.reply('⏳ Şarkı bilgileri alınıyor...');

    try {
        const songs = await getSongInfo(url);
        if (!songs || songs.length === 0) {
            return loadingMsg.edit('❌ Geçersiz veya desteklenmeyen link! YouTube, YT Music veya Spotify linki kullanın.');
        }

        const queue = getQueue(message.guild.id);
        queue.textChannel = message.channel;

        const isFirstSong = queue.songs.length === 0;

        // Şarkıları kuyruğa ekle
        queue.songs.push(...songs);

        // Mesajı güncelle
        if (songs.length === 1) {
            if (isFirstSong) {
                await loadingMsg.edit(`✅ **${songs[0].title}** kuyruğa eklendi!`);
            } else {
                await loadingMsg.edit(`✅ Kuyruğa eklendi (#${queue.songs.length}): **${songs[0].title}** [${songs[0].duration}] (${songs[0].source})`);
            }
        } else {
            await loadingMsg.edit(`✅ **${songs.length} şarkı** kuyruğa eklendi!`);
        }

        // Eğer ilk şarkıysa (bağlantı yoksa), bağlan ve çal
        if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
            // Sesli kanala bağlan
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: true,
            });

            queue.connection = connection;

            // Audio Player oluştur
            const player = createAudioPlayer();
            queue.player = player;

            // Player eventleri
            player.on(AudioPlayerStatus.Idle, () => {
                // Mevcut şarkıyı kuyruktan çıkar
                queue.songs.shift();
                // Sonraki şarkıyı çal
                playNext(message.guild.id);
            });

            player.on('error', (error) => {
                console.error('[MusicPlayer] Player hatası:', error.message);
                queue.songs.shift();
                playNext(message.guild.id);
            });

            // Bağlantıyı player'a subscribe et
            connection.subscribe(player);

            // Bağlantı kesilirse temizle
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                    // Yeniden bağlanıyor...
                } catch {
                    // Tamamen bağlantı kesildi
                    connection.destroy();
                    queues.delete(message.guild.id);
                }
            });

            connection.on(VoiceConnectionStatus.Destroyed, () => {
                queues.delete(message.guild.id);
            });

            // İlk şarkıyı çal
            await playNext(message.guild.id);
        }
    } catch (error) {
        console.error('[MusicPlayer] Play komutu hatası:', error);
        await loadingMsg.edit(`❌ Bir hata oluştu: ${error.message}`);
    }
}

/**
 * !stop komutu handler
 */
async function handleStopCommand(message) {
    const queue = queues.get(message.guild.id);
    if (!queue || !queue.connection) {
        return message.reply('❌ Şu anda müzik çalmıyor!');
    }

    clearIdleTimeout(message.guild.id);
    queue.songs = [];

    // yt-dlp process'ini öldür
    if (queue.currentProcess) {
        try { queue.currentProcess.kill('SIGTERM'); } catch { }
        queue.currentProcess = null;
    }

    if (queue.player) {
        queue.player.stop(true);
    }

    if (queue.connection) {
        queue.connection.destroy();
    }

    queues.delete(message.guild.id);
    await message.reply('⏹️ Müzik durduruldu ve kuyruk temizlendi.');
}

/**
 * !skip komutu handler
 */
async function handleSkipCommand(message) {
    const queue = queues.get(message.guild.id);
    if (!queue || !queue.player) {
        return message.reply('❌ Şu anda müzik çalmıyor!');
    }

    if (queue.songs.length <= 1) {
        await message.reply('⏭️ Son şarkı atlanıyor...');
    } else {
        await message.reply(`⏭️ **${queue.songs[0].title}** atlanıyor...`);
    }

    // Player'ı durdur — Idle eventi tetiklenecek ve sonraki şarkıya geçecek
    queue.player.stop();
}

/**
 * !queue komutu handler
 */
async function handleQueueCommand(message) {
    const queue = queues.get(message.guild.id);
    if (!queue || queue.songs.length === 0) {
        return message.reply('📋 Kuyruk boş.');
    }

    const lines = queue.songs.map((song, i) => {
        const prefix = i === 0 ? '🎵 Şimdi çalınıyor' : `#${i}`;
        return `${prefix}: **${song.title}** [${song.duration}] (${song.source})`;
    });

    const embed = `📋 **Müzik Kuyruğu** (${queue.songs.length} şarkı)\n\n${lines.join('\n')}`;

    await message.reply(embed);
}

module.exports = {
    handlePlayCommand,
    handleStopCommand,
    handleSkipCommand,
    handleQueueCommand,
};
