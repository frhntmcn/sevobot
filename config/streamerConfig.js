// config/streamerConfig.js

// Configuration for Stream Monitoring
// This file allows defining which Twitch/Kick channels to watch for each Discord Server (Guild).
// Key: Guild ID (String)
// Value: Object containing notification settings and streamer lists.

module.exports = {
    // Example Guild ID (Replace with your actual Server ID)
    "YOUR_DISCORD_GUILD_ID": {
        // The Channel ID where notifications will be posted
        notificationChannelId: "YOUR_DISCORD_CHANNEL_ID",

        // List of Twitch usernames to monitor
        twitch: [
            "twitch_user1",
            "twitch_user2"
        ],

        // List of Kick slugs/usernames to monitor
        kick: [
            "kick_user1"
        ]
    }
};
