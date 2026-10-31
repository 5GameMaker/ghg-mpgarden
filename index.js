const backend = typeof window.webxdc !== 'undefined' ? 'webxdc'
                : typeof window.LibAMX !== 'undefined' ? 'amx'
                : 'offline';

console.log(`using ${backend} backend`);

window.MPGarden = {
    enableDebugOutput: false,
};

class Tile {
    /** @type {number} */
    x;
    /** @type {number} */
    y;
    /** @type {'grass'|'tilled'} */
    kind;
    /** @type {'grass'|'tilled'} */
    tex;

    toData() {
        return [this.x, this.y, this.kind];
    }
    static fromData(data) {
        const tile = new Tile();
        tile.x = data[0];
        tile.y = data[1];
        tile.kind = data[2];
        tile.tex = data[2];
        return tile;
    }

    static grass(x, y) {
        const tile = new Tile();
        tile.x = x;
        tile.y = y;
        tile.kind = 'grass';
        tile.tex = 'grass';
        return tile;
    }
    static tilled(x, y) {
        const tile = new Tile();
        tile.x = x;
        tile.y = y;
        tile.kind = 'tilled';
        tile.tex = 'tilled';
        return tile;
    }
}

class Player {
    /** @type {string} */
    name;
    /** @type {string} */
    id;
    /** @type {number[]} */
    sessionId;
    /** @type {number} */
    x;
    /** @type {number} */
    y;

    flipped = false;
}

// const sendUpdateInterval = backend == 'webxdc'
//     ? (typeof webxdc.sendUpdateInterval == 'number' ? webxdc.sendUpdateInterval : 10000)
//     : backend == 'amx' ? ;
// const sendUpdateMaxSize = typeof webxdc.sendUpdateMaxSize == 'number' ? webxdc.sendUpdateMaxSize : 10000;

const camera = {
    x: 0,
    y: 0,
};

const isTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);

const tileset = {
    image: new Image(),
    grass: [16, 16, 16, 16],
    tilled: [64, 16, 16, 16],
    player: [0, 48, 16, 16],
};
tileset.image.src = "tileset.png";

const int = x => Math.floor(x);
const packVars = (x, y) => `${int(x)}:${int(y)}`;
const cmparrs = (/** @type {any[]} */ a, /** @type {any[]} */ b) => a.length == b.length && a.every((x, i) => b[i] == x);

/** @type {Map<string, Tile>} */
const world = new Map();
const getTile = (x, y) => world.get(packVars(x, y));
const setTile = (x, y, tile) => tile instanceof Tile
    ? world.set(packVars(x, y), tile)
    : world.delete(packVars(x, y));
let loaded = false;

/** @type {Map<string, Player>} */
const players = new Map();
/** @type {Player} */
let player = null;
let playerPositionChanged = false;
let isHost = false;
let onWorldLoadEvent = null;

let channel = null;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const keys = {};
const tapped = {};
window.addEventListener('keydown', event => {
    keys[event.key.toLowerCase()] = true;
    tapped[event.key.toLowerCase()] = true;
});
window.addEventListener('keyup', event => {
    keys[event.key.toLowerCase()] = false;
    tapped[event.key.toLowerCase()] = false;
});

/** @type {({ x: number, y: number, idx: number, vx: number, vy: number }) | null} */
let touchHandler = null;

function createSaveData() {
    const payload = { world: [] };
    for (const [_, tile] of world) {
        payload.world.push(tile.toData());
    }
    return payload;
}

function saveWorld() {
    const payload = createSaveData();
    if (backend == 'webxdc') {
        webxdc.sendUpdate({ payload });
    } else {
        window.localStorage.setItem("world", JSON.stringify(payload));
    }
}

function loadWorld(d) {
    world.clear();
    if (Array.isArray(d.world)) for (const pt of d.world) {
        setTile(pt[0], pt[1], Tile.fromData(pt));
    }
}

function randomText() {
    const arr = [];
    for (let i = 0; i < 32; i++) {
        const rng = Math.floor(Math.random() * 35);
        if (rng >= 10) arr.push(rng - 10 + 'a'.charCodeAt(0));
        else arr.push(rng + '0'.charCodeAt(0));
    }
    return String.fromCharCode(...arr);
}

const sessionId = (() => {
    const bytes = [];
    for (let i = 0; i < 32; i++)
        bytes.push(~~(Math.random() * 256));
    return bytes;
})();

function eventJoin() {
    console.log(`emit(join)`);
    const tmp = new ArrayBuffer(4);
    const dataView = new DataView(tmp);
    // packet 1: join
    const array = [1];
    { // id (i16le)
        const str = textEncoder.encode(player.id);
        dataView.setUint16(0, str.length);
        array.push(...new Uint8Array(tmp, 0, 2));
        array.push(...str);
    }
    pos = array.length;
    { // name (i16le)
        const str = textEncoder.encode(player.name);
        dataView.setUint16(0, str.length);
        array.push(...new Uint8Array(tmp, 0, 2));
        array.push(...str);
    }
    // Session ID (32 bytes)
    array.push(...sessionId);
    dataView.setFloat32(0, player.x);
    array.push(...new Uint8Array(tmp, 0, 4));
    dataView.setFloat32(0, player.y);
    array.push(...new Uint8Array(tmp, 0, 4));
    channel.send(new Uint8Array(array));
}

function eventNewPosition() {
    console.log(`emit(newPosition)`);
    const tmp = new ArrayBuffer(4);
    const dataView = new DataView(tmp);
    // packet 2: new position
    const array = [2];
    { // id (i16le)
        const str = textEncoder.encode(player.id);
        dataView.setUint16(0, str.length);
        array.push(...new Uint8Array(tmp, 0, 2));
        array.push(...str);
    }
    dataView.setFloat32(0, player.x);
    array.push(...new Uint8Array(tmp, 0, 4));
    dataView.setFloat32(0, player.y);
    array.push(...new Uint8Array(tmp, 0, 4));
    channel.send(new Uint8Array(array));
}

function eventAmxLoadWorld() {
    console.log(`emit(loadWorld)`);
    const tmp = new ArrayBuffer(4);
    const dataView = new DataView(tmp);
    // packet 100: loadWorld (amx only)
    const array = [100];
    {
        const str = textEncoder.encode(JSON.stringify(createSaveData()));
        dataView.setUint32(0, str.length);
        array.push(...new Uint8Array(tmp, 0, 4));
        array.push(...str);
    }
    channel.send(new Uint8Array(array));
}

function eventKeepAlive() {
    console.log(`emit(keepAlive)`);
    // packet 254: keepAlive
    const array = [254];
    channel.send(new Uint8Array(array));
}

function eventLeave() {
    console.log(`emit(leave)`);
    const tmp = new ArrayBuffer(4);
    const dataView = new DataView(tmp);
    // packet 255: leave
    const array = [255];
    { // id (i16le)
        const str = textEncoder.encode(player.id);
        dataView.setUint16(0, str.length);
        array.push(...new Uint8Array(tmp, 0, 2));
        array.push(...str);
    }
    channel.send(new Uint8Array(array));
}

function processEvent(/** @type {Uint8Array} */ data) {
    const dataView = new DataView(data.buffer);
    const packetId = dataView.getUint8(0);

    if (packetId == 1) { // packet 1: join 
        let pos = 1;
        const idLen = dataView.getUint16(pos);
        pos += 2;
        const id = textDecoder.decode(data.subarray(pos, pos + idLen));
        pos += idLen;

        const nameLen = dataView.getUint16(pos);
        pos += 2;
        const name = textDecoder.decode(data.subarray(pos, pos + nameLen));
        pos += nameLen;

        const sessionId = [...data.subarray(pos, pos + 32)];
        pos += 32;

        const x = dataView.getFloat32(pos);
        pos += 4;
        const y = dataView.getFloat32(pos);

        if (player.id == id) return;
        if (!players.has(id) || !cmparrs(sessionId, players.get(id).sessionId)) {
            console.log(`Player ${name} joined the game!`);
            const player = new Player();
            player.name = name;
            player.id = id;
            player.x = x;
            player.y = y;
            player.sessionId = sessionId;
            players.set(id, player);
            eventJoin();
        } else {
            const player = players.get(id);
            player.name = name;
            player.x = x;
            player.y = y;
        }
    }
    else if (packetId == 2) { // packet 2: new position
        let pos = 1;
        const idLen = dataView.getUint16(pos);
        pos += 2;
        const id = textDecoder.decode(data.subarray(pos, pos + idLen));
        pos += idLen;

        const x = dataView.getFloat32(pos);
        pos += 4;
        const y = dataView.getFloat32(pos);

        if (player.id == id) return;
        if (!players.has(id)) {
            console.log(`Discarding packet from player ${id} as they have never joined the game`);
            return;
        }

        const newPlayer = players.get(id);

        newPlayer.flipped = newPlayer.x == x ? newPlayer.flipped : newPlayer.x < x;

        newPlayer.y = y;
        newPlayer.x = x;
    }
    else if (packetId == 100 && backend == 'amx') { // packet 100: load world
        if (onWorldLoadEvent == null || loaded) return;

        let pos = 1;
        const idLen = dataView.getUint32(pos);
        pos += 4;
        const payload = textDecoder.decode(data.subarray(pos, pos + idLen));
        pos += idLen;

        loadWorld(JSON.parse(payload));
        onWorldLoadEvent();
        onWorldLoadEvent = null;
    }
    else if (packetId == 254) { // packet 254: keep alive
        // NOOP
    }
    else if (packetId == 255) { // packet 255: leave
        let pos = 1;
        const idLen = dataView.getUint16(pos);
        pos += 2;
        const id = textDecoder.decode(data.subarray(pos, pos + idLen));
        pos += idLen;

        if (player.id == id) return;
        if (!players.has(id)) {
            console.log(`Discarding packet from player ${id} as they have never joined the game`);
            return;
        }

        const newPlayer = players.get(id);
        console.log(`Player ${newPlayer.name} left the game!`);
        players.delete(id);
    } else {
        console.log(`Invalid packet ID ${packetId} from player ${id}`);
    }
}

if (backend == 'webxdc') {
    channel = window.webxdc.joinRealtimeChannel();
    channel.setListener(processEvent);
} else if (backend == 'amx') {
    if (!location.hash.length) {
        location.hash = randomText();
    }
    channel = window.LibAMX.AmxSocket.publicRoom(`game.mpgarden.v1.${location.hash}`);
    channel.autoreconnect = true;
    channel.onmessage = (msg) => {
        if (msg.type == 'join' && loaded) {
            eventAmxLoadWorld();
        } else if (msg.type == 'msg') {
            if (typeof msg.content == 'string') return;
            processEvent(new Uint8Array(msg.content));
        }
    };
} else {
    channel = {
        // STUB: no network in offline mode.
        send() {}
    };
}

Promise.all([
    new Promise((res, rej) => {
        tileset.image.onload = () => res();
        tileset.image.onerror = rej;
    }),
    // This may desync which may be really bad.
    //
    // Oh well.
    Promise.race([
        new Promise(res => {
            if (backend == 'webxdc') {
                webxdc.setUpdateListener(d => {
                    if (d.serial != d.maxSerial) return;
                    if (loaded) return;
                    loaded = true;

                    console.log(`Loading world: ${JSON.stringify(d)}`);
                    loadWorld(d.payload);
                    res();
                });
            } else if (backend == 'amx') {
                onWorldLoadEvent = () => {
                    loaded = true;
                    res();
                };
                // On amx backend, players will send their worlds.
                // this is ridiculously inefficient, but as there
                // is no host nor an authority on the world, this
                // is the best we can get.
            }
        }),
        new Promise(res => setTimeout(() => {
            if (loaded) return;

            if (backend == 'offline' || backend == 'amx') {
                const world = localStorage.getItem("world");
                if (world != null) {
                    loaded = true;
                    loadWorld(JSON.parse(world));
                    res();
                }
            }

            for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) setTile(x, y, Tile.grass(x, y));
            setTile(1, 1, Tile.tilled(1, 1));

            saveWorld();
            onWorldLoadEvent = null;
            loaded = true;

            res();
        }, backend == 'offline' ? 0 : backend == 'webxdc' ? 1000 : 5000)),
    ]),
]).then(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d', { desynchronized: true });

    player = (() => {
        const player = new Player();
        player.name = backend == 'webxdc' ? webxdc.selfName : `PLAYER ${Math.floor(Math.random() * 10000)}`;
        player.x = 0;
        player.y = 0;
        player.id = backend == 'webxdc' ? webxdc.selfAddr : `id${Math.random()}`;
        player.sessionId = sessionId;
        return player;
    })();
    players.set(player.id, player);

    eventJoin();

    setInterval(() => {
        eventKeepAlive();
    }, 10000);

    window.addEventListener('beforeunload', () => {
        eventLeave();
    });

    window.addEventListener('touchstart', event => {
        event.preventDefault();

        const touch = event.changedTouches[0];
        if (!touch) return;
        if (touchHandler != null) return;

        touchHandler = {
            x: touch.pageX,
            y: touch.pageY,
            idx: touch.identifier,
            vx: 0,
            vy: 0,
        };
    });
    window.addEventListener('touchmove', event => {
        event.preventDefault();

        if (touchHandler == null) return;

        for (const touch of event.changedTouches) {
            if (touchHandler == null) {
                touchHandler = {
                    x: touch.x,
                    y: touch.y,
                    idx: touch.identifier,
                    vx: 0,
                    vy: 0,
                };
            }
            else if (touch.identifier != touchHandler.idx) continue;

            touchHandler.vx = (touch.pageX - touchHandler.x) / tilesize * 2;
            touchHandler.vy = (touch.pageY - touchHandler.y) / tilesize * 2;

            if (touchHandler.vx < -1) touchHandler.vx = -1;
            if (touchHandler.vx > 1) touchHandler.vx = 1;
            if (touchHandler.vy < -1) touchHandler.vy = -1;
            if (touchHandler.vy > 1) touchHandler.vy = 1;

            break;
        }
    });
    window.addEventListener('touchend', event => {
        event.preventDefault();

        if (touchHandler == null) return;

        for (const touch of event.changedTouches) {
            if (touch.identifier != touchHandler.idx) continue;

            touchHandler = null;
            break;
        }
    });
    window.addEventListener('touchcancel', event => {
        event.preventDefault();

        if (touchHandler == null) return;

        for (const touch of event.changedTouches) {
            if (touch.identifier != touchHandler.idx) continue;

            touchHandler = null;
            break;
        }
    });

    let time = window.performance.now() / 1000;
    let delta = 0;
    let tilesize = 0;
    let playerPosUpdateTimeout = 0;
    function loop(newTime) {
        newTime /= 1000;
        delta = newTime - time;
        time = newTime;

        const playerSpeed = 1.75;
        if (keys.w || keys.arrowup) {
            playerPositionChanged = true;
            player.y -= playerSpeed * delta;
        }
        if (keys.a || keys.arrowleft) {
            playerPositionChanged = true;
            player.x -= playerSpeed * delta;
            if (tapped.a || tapped.arrowleft) player.flipped = false;
        }
        if (keys.s || keys.arrowdown) {
            playerPositionChanged = true;
            player.y += playerSpeed * delta;
        }
        if (keys.d || keys.arrowright) {
            playerPositionChanged = true;
            player.x += playerSpeed * delta;
            if (tapped.d || tapped.arrowright) player.flipped = true;
        }

        if (touchHandler != null) {
            console.log(touchHandler);
            player.x += playerSpeed * delta * touchHandler.vx;
            player.y += playerSpeed * delta * touchHandler.vy;
            if (touchHandler.vx != 0) player.flipped = touchHandler.vx > 0;
        }

        camera.x = player.x;
        camera.y = player.y;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        tilesize = int(Math.min(canvas.width, canvas.height) / 6);

        ctx.fillStyle = "#1f3f03";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const startTX = -Math.ceil(canvas.width / tilesize / 2);
        const startTY = -Math.ceil(canvas.height / tilesize / 2);
        const endTX = -startTX;
        const endTY = -startTY;

        for (let dx = startTX; dx <= endTX; dx++) for (let dy = startTY; dy <= endTY; dy++) {
            const tile = getTile(dx, dy);
            if (tile == null) continue;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tileset.image,
                ...tileset[tile.tex],
                int(tilesize * dx - tilesize / 2 + canvas.width / 2 - camera.x * tilesize),
                int(tilesize * dy - tilesize / 2 + canvas.height / 2 - camera.y * tilesize),
                tilesize, tilesize);
        }

        const sortedPlayers = [...players.values()];
        sortedPlayers.sort((a, b) => a.y - b.y);
        for (const player of sortedPlayers) {
            ctx.imageSmoothingEnabled = false;

            ctx.save();
            ctx.translate(
                int(tilesize * player.x + canvas.width / 2 - camera.x * tilesize),
                int(tilesize * player.y + canvas.height / 2 - camera.y * tilesize),
            );
            ctx.translate(int(tilesize / 8), int(tilesize / 16));
            if (player.flipped) ctx.scale(-1, 1);
            ctx.filter = "brightness(0%)";
            ctx.globalAlpha = 0.3;
            ctx.drawImage(tileset.image,
                ...tileset.player,
                -tilesize / 2, -tilesize / 2,
                tilesize, tilesize);
            if (player.flipped) ctx.scale(-1, 1);
            ctx.translate(-int(tilesize / 8), -int(tilesize / 16));
            if (player.flipped) ctx.scale(-1, 1);
            ctx.filter = "brightness(100%)";
            ctx.globalAlpha = 1;
            ctx.drawImage(tileset.image,
                ...tileset.player,
                -tilesize / 2, -tilesize / 2,
                tilesize, tilesize);
            if (player.flipped) ctx.scale(-1, 1);
            ctx.restore();
        }
        for (const player of sortedPlayers) {
            ctx.imageSmoothingEnabled = false;

            ctx.save();
            ctx.translate(
                int(tilesize * player.x + canvas.width / 2 - camera.x * tilesize),
                int(tilesize * player.y + canvas.height / 2 - camera.y * tilesize),
            );
            ctx.translate(0, -0.6 * tilesize);
            ctx.font = `500 ${tilesize / 4}px sans-serif`;
            ctx.fillStyle = "black";
            const textWidth = ctx.measureText(player.name).width;
            ctx.globalAlpha = 0.3;
            ctx.translate(4, 2);
            ctx.fillText(player.name, -textWidth / 2, 0);
            ctx.translate(-4, -2);
            ctx.fillStyle = "white";
            ctx.globalAlpha = 1;
            ctx.fillText(player.name, -textWidth / 2, 0);
            ctx.restore();
        }

        for (const key in tapped) tapped[key] = false;
        playerPosUpdateTimeout -= delta;
        if (playerPositionChanged && playerPosUpdateTimeout <= 0) {
            playerPosUpdateTimeout = 0.1;
            playerPositionChanged = false;

            eventNewPosition();
        }
        window.requestAnimationFrame(loop);
    }
    window.requestAnimationFrame(loop);
});
