var board = null;
var game = new Chess();
let cplayer = null;
let currentMatchtime = null;
let timerinstance = null;
let rematchAccepted = false;
let promotionMove = null;
let displayedMovesCount = 0;
var $pgn = $('#pgn')
let formatted = "";
const socket = io("http://localhost:3000");

document.addEventListener('DOMContentLoaded', function () {
    const name = localStorage.getItem("playerName");
    const color = localStorage.getItem("preferredColor");
    const time = Number(localStorage.getItem("preferredTime"));

    document.getElementById('main-element').style.display = 'none';
    document.getElementById('waiting-text').style.display = 'block';

    socket.emit("want_to_play", { name, color, time });

    socket.on("total_player_count_change", function (totalPlayers) {
        document.getElementById("total_players").innerText = "Total Players : " + totalPlayers;
    });

    socket.on("match_made", (color, matchTime) => {
        cplayer = color;
        currentMatchtime = matchTime;
        const currentplayer = color === 'b' ? 'Black' : 'White';

        document.getElementById('waiting-text').style.display = 'none';
        document.getElementById('main-element').style.display = 'flex';
        document.getElementById('player_info').innerText = `You are playing as ${currentplayer}`;
        document.getElementById('player_name').innerText = `${name}`;
        document.getElementById('chat-container').style.display = 'block';

        startNewGame();
    });

    socket.on('sync_state_from_server', function(fen, turn, moveHistory) {
        game.load(fen);
        board.position(fen, true);
        
        // Restore the move history
        if (moveHistory && moveHistory.length > 0) {
            // Clear current moves and replay all moves to rebuild game state
            game.reset();
            moveHistory.forEach(move => {
                game.move(move);
            });
        }
        
        updateMoveHistory();
        if (timerinstance) timerinstance.resume();
        else startTimer(currentMatchtime * 60);
    });
    
    socket.on('game_over_from_server', function (winner) {
        if (timerinstance) timerinstance.pause();
        rematchAccepted = false;
        let resultText = winner === 'draw' ? `It's a Draw!` : `${winner} won the match`;
        document.getElementById('buttonparent').innerHTML = `
            <p class='text-xl font-bold'>${resultText}</p>
            <button onclick="requestRematch()">Rematch</button>
            <button id="quitBtn" onclick="quitGame()">Quit</button>
        `;
    });

    socket.on('rematch_requested', () => {
        if (!rematchAccepted) {
            rematchAccepted = true;
            const rematchBtn = document.querySelector("button[onclick='requestRematch()']");
            if (rematchBtn) rematchBtn.innerText = "Opponent requested rematch";
        } else {
            document.getElementById('buttonparent').innerHTML = '';
            startNewGame();
        }
    });

    socket.on('opponent_left', () => {
        alert("Opponent left the match.");
        window.location.href = "index.html";
    });

    socket.on("chat_message", ({ sender, message }) => {
        const chatBox = document.getElementById("chat-box");
        const msg = document.createElement("p");
        msg.innerText = `${sender}: ${message}`;
        chatBox.appendChild(msg);
        chatBox.scrollTop = chatBox.scrollHeight;
    });

    document.getElementById("send-btn").addEventListener("click", () => {
        const message = document.getElementById("chat-input").value;
        if (message.trim()) {
            socket.emit("chat_message", { message });
            document.getElementById("chat-input").value = "";
        }
    });

    document.getElementById("chat-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") document.getElementById("send-btn").click();
    });
});

function requestRematch() {
    socket.emit('rematch_request');
    rematchAccepted = true;
    const rematchBtn = document.querySelector("button[onclick='requestRematch()']");
    if (rematchBtn) rematchBtn.innerText = "Waiting for opponent...";
    const quitBtn = document.getElementById("quitBtn");
    if (quitBtn) quitBtn.disabled = true;
}

function quitGame() {
    window.location.href = "index.html";
}

function startNewGame() {
    rematchAccepted = false;
    game.reset();
    board.clear();
    board.start();
    board.orientation(cplayer === 'b' ? 'black' : 'white');
    temp=0;
    allmoves=[];
    if (timerinstance) timerinstance.pause();
    timerinstance = null;

    document.getElementById('buttonparent').innerHTML = '';
    document.getElementById('timerdisplay').innerText = currentMatchtime + ":00";
    document.getElementById('pgn').innerHTML = '';
    document.getElementById("chat-box").innerHTML = "";
    displayedMovesCount = 0;

    updateStatus();

    if (game.turn() === cplayer) {
        startTimer(currentMatchtime * 60);
    }
}

function startTimer(seconds) {
    if (timerinstance) timerinstance.pause();
    timerinstance = createTimer(seconds, 'timerdisplay', () => {
        alert('Time up!');
    });
}

function onDragStart(source, piece) {
    if (game.turn() !== cplayer || game.game_over()) return false;
    if ((game.turn() === 'w' && piece.startsWith('b')) || (game.turn() === 'b' && piece.startsWith('w'))) {
        return false;
    }
}

function onDrop(source, target) {
    const piece = game.get(source);
    if (piece && piece.type === 'p' &&
        ((piece.color === 'w' && target[1] === '8') ||
         (piece.color === 'b' && target[1] === '1'))) {
        promotionMove = { from: source, to: target };
        showPromotionDialog();
        return;
    }
    return tryMove(source, target, 'q');
}

function tryMove(source, target, promotion) {
    const move = game.move({ from: source, to: target, promotion });
    if (move === null) return 'snapback';

    board.position(game.fen(), true);
    
    // Send current FEN, turn, and the complete move history
    socket.emit('sync_state', game.fen(), game.turn(), game.history());
    
    updateMoveHistory();
    if (timerinstance) timerinstance.pause();
    updateStatus();
}

function promote(piece) {
    hidePromotionDialog();
    if (promotionMove) {
        tryMove(promotionMove.from, promotionMove.to, piece);
        promotionMove = null;
    }
}

function showPromotionDialog() {
    const modal = document.getElementById('promotion-modal');
    modal.style.display = 'block';
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
}

function hidePromotionDialog() {
    document.getElementById('promotion-modal').style.display = 'none';
}

function onSnapEnd() {
    board.position(game.fen());
}

function updateStatus() {
    if (game.in_checkmate()) {
        const winner = game.turn() === 'b' ? 'White' : 'Black';
        socket.emit('game_over', winner);
    } else if (game.in_draw()) {
        socket.emit('game_over', 'draw');
    }
}

function createTimer(seconds, container, oncomplete) {
    let starttime, timer, ms = seconds * 1000;
    const display = document.getElementById(container);
    let obj = {};

    obj.resume = function () {
        starttime = new Date().getTime();
        timer = setInterval(obj.step, 250);
    };

    obj.pause = function () {
        ms = obj.step();
        clearInterval(timer);
    };

    obj.step = function () {
        let now = Math.max(0, ms - (new Date().getTime() - starttime)),
            m = Math.floor(now / 60000),
            s = Math.floor(now / 1000) % 60;
        display.innerHTML = m + ':' + (s < 10 ? '0' + s : s);
        if (now === 0) {
            clearInterval(timer);
            if (oncomplete) oncomplete();
        }
        return now;
    };

    obj.resume();
    return obj;
}

function updateMoveHistory() {
    const pgnElement = document.getElementById('pgn');
    pgnElement.innerHTML = ''; // Clear previous moves
    
    const history = game.history();
    let moveNumber = 1;
    let moveText = '';
    
    // Process moves in pairs (white and black)
    for (let i = 0; i < history.length; i += 2) {
        const whiteMove = history[i] || '';
        const blackMove = history[i+1] || ''; // Might be undefined if odd number of moves
        
        moveText += `${moveNumber}. ${whiteMove}`;
        if (blackMove) {
            moveText += ` ${blackMove}`;
        }
        moveText += '<br>';
        moveNumber++;
    }
    
    pgnElement.innerHTML = moveText;
}

const config = {
    draggable: true,
    position: 'start',
    onDragStart,
    onDrop,
    onSnapEnd
};
board = Chessboard('myBoard', config);
