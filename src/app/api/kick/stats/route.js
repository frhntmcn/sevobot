import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const STATS_PATH = path.join(process.cwd(), 'data', 'kickChatStats.json');

function readStats() {
    try {
        if (fs.existsSync(STATS_PATH)) {
            return JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
        }
    } catch (err) {
        console.error('[KickStatsAPI] Read error:', err.message);
    }
    return {};
}

/**
 * GET /api/kick/stats
 * Kick chat kullanıcı mesaj istatistiklerini döndürür.
 */
export async function GET() {
    try {
        const chatStats = readStats();

        // Sort by message count descending
        const sorted = Object.entries(chatStats)
            .sort((a, b) => b[1] - a[1])
            .map(([username, count], index) => ({
                rank: index + 1,
                username,
                messageCount: count
            }));

        const totalMessages = sorted.reduce((sum, u) => sum + u.messageCount, 0);

        return NextResponse.json({
            totalUsers: sorted.length,
            totalMessages,
            users: sorted
        });
    } catch (e) {
        return NextResponse.json(
            { error: 'Chat stats not available: ' + e.message },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/kick/stats
 * İstatistikleri sıfırlar.
 */
export async function DELETE() {
    try {
        const dir = path.dirname(STATS_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(STATS_PATH, JSON.stringify({}, null, 2), 'utf-8');

        // Also try to clear runtime stats if module is accessible
        try {
            const kickChatManager = require('../../../../../services/kickChatManager');
            kickChatManager.resetChatStats();
        } catch (e) {
            // Module might not be in same process
        }

        return NextResponse.json({ success: true, message: 'Stats reset' });
    } catch (e) {
        return NextResponse.json(
            { error: 'Could not reset stats: ' + e.message },
            { status: 500 }
        );
    }
}
