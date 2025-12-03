import { NextResponse } from 'next/server';
import { store } from '@/lib/gameState';

// Helper to print board
function printBoard(board) {
    const symbols = board.map(c => c ? c : '⬜');
    return `
${symbols[0]} ${symbols[1]} ${symbols[2]}
${symbols[3]} ${symbols[4]} ${symbols[5]}
${symbols[6]} ${symbols[7]} ${symbols[8]}
`.trim();
}

// Helper to check win
function checkWin(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

// Core Game Logic
function processGameCommand(user, command) {
    if (!command || !user) {
        return { message: "Komut veya kullanıcı eksik.", status: 400 };
    }

    // Normalize command: ensure it starts with !xox for parsing consistency
    // If Botrix sends just "davet ali", we prefix it.
    let fullCommand = command.trim();
    if (!fullCommand.toLowerCase().startsWith('!xox')) {
        fullCommand = `!xox ${fullCommand}`;
    }

    const parts = fullCommand.split(/\s+/);
    // parts[0] is !xox
    const action = parts[1] ? parts[1].toLowerCase() : null;

    // --- INVITE ---
    if (action === 'invite' || action === 'davet') {
        const target = parts[2];
        if (!target) return { message: "Kimi davet etmek istiyorsun? Örnek: !xox davet ali" };

        if (store.userMap[user]) return { message: "Zaten bir oyundasın." };
        if (store.userMap[target]) return { message: `${target} şu an başka bir oyunda.` };

        store.invites[target] = user;
        return { message: `@${target}, @${user} seni XOX oyununa davet etti! Kabul etmek için: !xox kabul` };
    }

    // --- ACCEPT ---
    if (action === 'accept' || action === 'kabul') {
        const inviter = store.invites[user];
        if (!inviter) return { message: "Sana gelen bir davet yok." };

        // Start Game
        const gameId = `${inviter}-${user}-${Date.now()}`;
        const newGame = {
            id: gameId,
            p1: inviter,
            p2: user,
            board: Array(9).fill(null),
            turn: inviter, // P1 starts
            symbol: { [inviter]: 'X', [user]: 'O' }
        };

        store.games[gameId] = newGame;
        store.userMap[inviter] = gameId;
        store.userMap[user] = gameId;
        delete store.invites[user];

        return {
            message: `Oyun başladı! 🎮\n\n@${inviter} kişisi (X) sembolünü kullanacak.\n@${user} kişisi (O) sembolünü kullanacak.\n\nSıra @${inviter}'de. Hamle yapmak için: !xox 1`
        };
    }

    // --- MOVE (e.g. !xox 1-9) ---
    const moveMatch = action ? action.match(/^([1-9])$/) : null;

    if (moveMatch) {
        const gameId = store.userMap[user];
        if (!gameId) return { message: "Şu an bir oyunda değilsin." };

        const game = store.games[gameId];
        if (game.turn !== user) return { message: "Sıra sende değil!" };

        // Parse move (1-9) -> index (0-8)
        const index = parseInt(moveMatch[1]) - 1;

        if (game.board[index]) return { message: "Orası dolu!" };

        // Make move
        const symbol = game.symbol[user];
        game.board[index] = symbol;

        // Check Win
        const winner = checkWin(game.board);
        if (winner) {
            // Game Over
            delete store.userMap[game.p1];
            delete store.userMap[game.p2];
            delete store.games[gameId];
            return {
                message: `Oyun bitti! Kazanan: @${user} 🎉\n\n${printBoard(game.board)}`
            };
        }

        // Check Draw
        if (!game.board.includes(null)) {
            delete store.userMap[game.p1];
            delete store.userMap[game.p2];
            delete store.games[gameId];
            return {
                message: `Oyun berabere bitti! 🤝\n\n${printBoard(game.board)}`
            };
        }

        // Switch Turn
        game.turn = game.turn === game.p1 ? game.p2 : game.p1;
        return {
            message: `Hamle yapıldı.\n\n${printBoard(game.board)}\n\nSıra @${game.turn}'de.`
        };
    }

    // --- STATUS ---
    if (action === 'status') {
        const gameId = store.userMap[user];
        if (!gameId) return { message: "Oyunda değilsin." };
        const game = store.games[gameId];
        return {
            message: `Oyun Durumu:\n\n${printBoard(game.board)}\n\nSıra: @${game.turn}`
        };
    }

    // --- RESIGN / QUIT ---
    if (action === 'quit' || action === 'pes') {
        const gameId = store.userMap[user];
        if (!gameId) return { message: "Oyunda değilsin." };

        const game = store.games[gameId];
        const winner = user === game.p1 ? game.p2 : game.p1;

        delete store.userMap[game.p1];
        delete store.userMap[game.p2];
        delete store.games[gameId];

        return { message: `@${user} pes etti. Kazanan: @${winner} 🏆` };
    }

    return { message: "Komut anlaşılamadı. (!xox davet, !xox kabul, !xox 1-9)" };
}

// --- HANDLERS ---

// 1. GET Handler for Botrix (Returns Plain Text)
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const user = searchParams.get('user');
        // Botrix sends arguments in 'command' or 'q' usually. 
        // We assume 'command' contains the part AFTER !xox or the full command.
        const command = searchParams.get('command') || "";

        const result = processGameCommand(user, command);

        // Return plain text for Botrix to display in chat
        return new Response(result.message, {
            status: result.status || 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    } catch (error) {
        console.error(error);
        return new Response("Sunucu hatası.", { status: 500 });
    }
}

// 2. POST Handler for Web UI (Returns JSON)
export async function POST(request) {
    try {
        const body = await request.json();
        const { command, user } = body;

        const result = processGameCommand(user, command);

        return NextResponse.json(result, { status: result.status || 200 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ message: "Sunucu hatası." }, { status: 500 });
    }
}
