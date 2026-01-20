const fs = require('fs');
const path = require('path');
const os = require('os');

// prioritized local data over /tmp for VDS
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Default initial state
const defaultData = {
    guilds: {},
    streamState: {}
};


class StorageService {
    constructor() {
        this.data = null; // Lazy load
    }

    ensureLoaded() {
        if (this.data) return;
        this.load();
    }

    load() {
        this.data = JSON.parse(JSON.stringify(defaultData));

        if (!fs.existsSync(DB_PATH)) {
            this.save();
            return;
        }

        try {
            const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
            this.data = JSON.parse(fileContent);

            // Ensure structure integrity
            if (!this.data.guilds) this.data.guilds = {};
            if (!this.data.streamState) this.data.streamState = {};

        } catch (error) {
            console.error('[STORAGE] Failed to load DB:', error);
        }
    }


    save() {
        try {
            const dir = path.dirname(DB_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('Failed to save DB:', error);
        }
    }

    // --- Guild Operations ---

    getGuild(guildId) {
        this.ensureLoaded();
        if (!this.data.guilds[guildId]) {
            this.data.guilds[guildId] = {
                notifyChannelId: null,
                mentionsEnabled: false, // Default optional as requested
                watched: [] // Array of { platform: 'twitch'|'kick', identify: string }
            };
            this.save();
        }
        return this.data.guilds[guildId];
    }

    setNotifyChannel(guildId, channelId) {
        const guild = this.getGuild(guildId);
        guild.notifyChannelId = channelId;
        this.save();
        return guild;
    }

    // --- Watch List Operations ---

    addWatch(guildId, platform, identifier) {
        const guild = this.getGuild(guildId);
        const exists = guild.watched.some(w => w.platform === platform && w.identifier === identifier);

        if (!exists) {
            guild.watched.push({ platform, identifier, vodEnabled: false });
            this.save();
            return true;
        }
        return false;
    }

    removeWatch(guildId, platform, identifier) {
        const guild = this.getGuild(guildId);
        const initialLen = guild.watched.length;
        guild.watched = guild.watched.filter(w => !(w.platform === platform && w.identifier === identifier));

        if (guild.watched.length !== initialLen) {
            this.save();
            return true;
        }
        return false;
    }

    getWatchList(guildId) {
        return this.getGuild(guildId).watched;
    }

    setVodEnabled(guildId, platform, identifier, enabled) {
        const guild = this.getGuild(guildId);
        const item = guild.watched.find(w => w.platform === platform && w.identifier === identifier);

        if (item) {
            item.vodEnabled = enabled;
            this.save();
            return true;
        }
        return false;
    }

    shouldDownloadVod(platform, identifier) {
        this.ensureLoaded();
        // Check if ANY guild has enabled VODs for this channel
        return Object.values(this.data.guilds).some(guild =>
            guild.watched.some(w => w.platform === platform && w.identifier === identifier && w.vodEnabled === true)
        );
    }

    getAllWatchedChannels() {
        this.ensureLoaded();
        // Returns unique list of channels to monitor globally
        // Returns: { twitch: Set<string>, kick: Set<string> }
        const result = { twitch: new Set(), kick: new Set() };

        Object.entries(this.data.guilds).forEach(([guildId, guild]) => {
            if (!guild.notifyChannelId) {
                console.log(`[STORAGE] Skipping guild ${guildId} - No notifyChannelId set.`);
                return; // Ignore guilds without setup
            };

            if (guild.watched.length === 0) {
                console.log(`[STORAGE] Guild ${guildId} has no watched channels.`);
                return;
            }

            console.log(`[STORAGE] Processing guild ${guildId} - ${guild.watched.length} channels.`);

            guild.watched.forEach(item => {
                if (result[item.platform]) {
                    result[item.platform].add(item.identifier);
                }
            });
        });
        return result;
    }

    // --- Dedupe & State Operations ---

    getStreamState(platform, identifier) {
        this.ensureLoaded();
        const key = `${platform}:${identifier}`;
        return this.data.streamState[key] || { lastStatus: 'offline', lastNotified: 0, lastStreamId: null };
    }

    updateStreamState(platform, identifier, newState) {
        const key = `${platform}:${identifier}`;
        this.data.streamState[key] = { ...this.getStreamState(platform, identifier), ...newState };
        this.save();
    }
}

module.exports = new StorageService();
