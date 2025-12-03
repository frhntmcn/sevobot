// Global in-memory store for game state
// Note: This resets when the server restarts (or in serverless environments)
// For a real production app, use a database like Redis or PostgreSQL.

const globalForXox = global;

if (!globalForXox.xoxStore) {
    globalForXox.xoxStore = {
        games: {}, // gameId -> gameObj
        userMap: {}, // username -> gameId
        invites: {} // targetUser -> sourceUser (last invite)
    };
}

export const store = globalForXox.xoxStore;
