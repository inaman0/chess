const { createServer } = require("http");
const { Server } = require("socket.io");

const PORT = 3000;
const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: "http://127.0.0.1:5500",
        methods: ["GET", "POST"],
    },
});

let totalPlayers = 0;
let players = {};
let waiting = { 10: [], 15: [], 20: [] };
let currentMatches = {};
let rematchRequests = {};

function fireTotalPlayers() {
    io.emit('total_player_count_change', totalPlayers);
}

function setupMatch(player1, player2, timer) {
    const [whiteID, blackID] = Math.random() > 0.5 ? [player1, player2] : [player2, player1];
    const white = players[whiteID];
    const black = players[blackID];

    if (!white || !black) return;

    white.removeAllListeners();
    black.removeAllListeners();

    white.emit('match_made', 'w', timer);
    black.emit('match_made', 'b', timer);

    currentMatches[whiteID] = blackID;
    currentMatches[blackID] = whiteID;
    rematchRequests[whiteID] = false;
    rematchRequests[blackID] = false;

    [white, black].forEach((player, idx) => {
        const opponent = idx === 0 ? black : white;
        const opponentID = idx === 0 ? blackID : whiteID;

        player.on('sync_state', (fen, turn, moveHistory) => {
            opponent.emit('sync_state_from_server', fen, turn, moveHistory);
        });

        player.on('game_over', winner => {
            player.emit('game_over_from_server', winner);
            opponent.emit('game_over_from_server', winner);
        });

        player.on('rematch_request', () => {
            rematchRequests[player.id] = true;
            if (rematchRequests[opponentID]) {
                setupMatch(player.id, opponentID, player.matchTime);
            } else {
                opponent.emit('rematch_requested');
            }
        });

        player.on('chat_message', ({ message }) => {
            const sender = player.playerName;
            player.emit('chat_message', { sender: "You", message });
            opponent.emit('chat_message', { sender, message });
        });
    });
}

function removesocket(socket) {
    [10, 15, 20].forEach(time => {
        const idx = waiting[time].indexOf(socket.id);
        if (idx > -1) waiting[time].splice(idx, 1);
    });
}

io.on("connection", (socket) => {
    players[socket.id] = socket;
    totalPlayers++;
    console.log("total players: "+totalPlayers);
    fireTotalPlayers();

    socket.on("want_to_play", ({ name, color, time }) => {
        socket.playerName = name;
        socket.preferredColor = color;
        socket.matchTime = time;

        if (waiting[time].length > 0) {
            const opponentID = waiting[time].shift();
            const opponent = players[opponentID];
            if (opponent) {
                setupMatch(socket.id, opponentID, time);
            } else {
                waiting[time].push(socket.id);
            }
        } else {
            waiting[time].push(socket.id);
        }
    });

    socket.on("disconnect", () => {
        totalPlayers = Math.max(0, totalPlayers - 1);
        fireTotalPlayers();

        removesocket(socket);

        const opponentID = currentMatches[socket.id];
        if (opponentID && players[opponentID]) {
            players[opponentID].emit('opponent_left');
        }

        delete players[socket.id];
        delete currentMatches[socket.id];
        delete currentMatches[opponentID];
        delete rematchRequests[socket.id];
        delete rematchRequests[opponentID];
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
