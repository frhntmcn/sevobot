import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config', 'kickConfig.json');
const STATUS_PATH = path.join(process.cwd(), 'data', 'kickStatus.json');

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        }
    } catch (err) {
        console.error('[KickConfigAPI] Read error:', err.message);
    }
    return null;
}

function readStatus() {
    try {
        if (fs.existsSync(STATUS_PATH)) {
            return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8'));
        }
    } catch (err) {
        // Status file might not exist yet
    }
    return null;
}

function writeConfig(data) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error('[KickConfigAPI] Write error:', err.message);
        return false;
    }
}

/**
 * GET /api/kick/config
 * Mevcut Kick config'ini ve runtime durumunu döndürür.
 */
export async function GET() {
    const config = readConfig();

    if (!config) {
        return NextResponse.json(
            { error: 'Config file not found or unreadable' },
            { status: 500 }
        );
    }

    // Read status from file (written by kickChatManager)
    const status = readStatus();

    return NextResponse.json({ config, status });
}

/**
 * POST /api/kick/config
 * Config'i günceller. Body olarak güncellenmiş config objesi beklenir.
 * 
 * Desteklenen alanlar: timers, commands, channelName
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const currentConfig = readConfig();

        if (!currentConfig) {
            return NextResponse.json(
                { error: 'Current config not found' },
                { status: 500 }
            );
        }

        // Sadece izin verilen alanları güncelle
        const allowedFields = ['timers', 'commands', 'channelName'];
        const updates = {};

        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                updates[field] = body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json(
                { error: 'No valid fields to update. Allowed: ' + allowedFields.join(', ') },
                { status: 400 }
            );
        }

        const updatedConfig = { ...currentConfig, ...updates };

        if (!writeConfig(updatedConfig)) {
            return NextResponse.json(
                { error: 'Failed to write config file' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            config: updatedConfig
        });

    } catch (err) {
        return NextResponse.json(
            { error: 'Invalid request: ' + err.message },
            { status: 400 }
        );
    }
}
