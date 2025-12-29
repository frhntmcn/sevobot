const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

// Default initial state
const defaultData = {
    guilds: {},
    // Dedupe cache: "platform:channelId" -> { lastStatus: 'offline', lastNotified: 0, lastStreamId: null }
    streamState: {}
};

class StorageService {
    constructor() {
        this.data = defaultData;
        this.load();
    }

    load() {
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
            console.error('Failed to load DB:', error);
            // Backup corrupt file if needed? For now just keep memory state or init new.
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
            guild.watched.push({ platform, identifier });
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

    getAllWatchedChannels() {
        // Returns unique list of channels to monitor globally
        // Returns: { twitch: Set<string>, kick: Set<string> }
        const result = { twitch: new Set(), kick: new Set() };

        Object.values(this.data.guilds).forEach(guild => {
            if (!guild.notifyChannelId) return; // Ignore guilds without setup
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
