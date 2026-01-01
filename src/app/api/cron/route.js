import { NextResponse } from 'next/server';
import { getAuthenticatedClient } from '../../../../../services/discordBot';
import { runCheck } from '../../../../../services/streamManager';
import logger from '../../../../../services/logger';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    // Optional: Add a simple key check if needed, e.g. ?key=123
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    // Simple protection
    if (key !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        logger.log("🕒 Cron Trigger Received.");

        // 1. Get Discord Client (Connect if needed)
        const client = await getAuthenticatedClient();

        // 2. Run Stream Check
        await runCheck(client);

        const logs = logger.getLogs().slice(0, 10); // Return last 10 logs as result

        return NextResponse.json({
            success: true,
            message: 'Stream check completed successfully.',
            recentLogs: logs
        });
    } catch (error) {
        logger.error("❌ Cron Job Failed:", error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
