import { NextResponse } from 'next/server';
import logger from '../../../../../services/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
    const logs = logger.getLogs();
    return NextResponse.json({
        timestamp: new Date().toISOString(),
        count: logs.length,
        logs: logs
    });
}
