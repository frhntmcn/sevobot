// Simple in-memory logger
const MAX_LOGS = 100;
const logs = [];

function addLog(type, message, ...args) {
    const timestamp = new Date().toLocaleTimeString('tr-TR', { hour12: false });
    const formattedArgs = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    const entry = `[${timestamp}] [${type}] ${message} ${formattedArgs}`;

    logs.push(entry);
    if (logs.length > MAX_LOGS) {
        logs.shift();
    }

    // Also log to console for local dev
    if (type === 'ERROR') console.error(message, ...args);
    else console.log(message, ...args);
}

module.exports = {
    log: (message, ...args) => addLog('INFO', message, ...args),
    warn: (message, ...args) => addLog('WARN', message, ...args),
    error: (message, ...args) => addLog('ERROR', message, ...args),
    getLogs: () => [...logs].reverse() // Newest first
};
