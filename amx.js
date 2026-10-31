// LibAMX - Interacting with AMX service.
//
// (c) buj, 2026. Distributed under MIT.
// This version differs from the one on <https://amx.mindurka.cc>. After cleanup,
// that version will be updated to this one.

(() => {
    const WebSocket =
        typeof window !== "undefined" ? window.WebSocket
      : typeof require === 'function' ? require('ws') // TODO: Node 26 bundled WebSocket
      : (() => { throw Error("could not determine how to find WebSocket") })()
      ;

    /**
     * @typedef {
     *     { type: 'msg', content: string | Uint8Array, user: string } |
     *     { type: 'join', user: string } |
     *     { type: 'leave', user: string } |
     *     { type: 'undefined', headers: Map<string, string>, content: string, user: string }
     *     { type: 'undefined', headers: Map<string, Uint8Array>, content: Uint8Array, user: string }
     * } AmxMessage
     */
    const exports = {};

    function uuidb2t(bytes) {
        let s = [];

        function printx(a) {
            if (a >= 10) s.push('a'.charCodeAt(0) + a - 10);
            else s.push('0'.charCodeAt(0) + a);
        }
        
        for (let i = 0; i < 16; i++) {
            const b = bytes[i];
            printx(b >> 4);
            printx(b % 16);
            if ([4, 6, 8, 10].includes(i + 1)) s.push('-'.charCodeAt(0));
        }

        return String.fromCharCode(...s);
    }
    exports.uuidb2t = uuidb2t;

    /**
     * @param {{ data: string | Uint8Array }} m
     * @returns {AmxMessage}
     */
    function processMessage(e) {
        if (typeof e.data === 'string') {
            if (exports.enableDebugOutput) console.log(e.data);
            const headerEnd = (i => i == -1 ? e.data.length : i)(e.data.indexOf('\n\n'));
            const headers = new Map(e.data
                .slice(0, headerEnd)
                .split('\n')
                .map(x => x.includes(' ') ? [x.slice(0, x.indexOf(' ')), x.slice(x.indexOf(' ') + 1)] : [x, ""]));
            if (headers.has("join")) {
                const user = headers.get("user");
                return { type: 'join', user };
            } else if (headers.has("leave")) {
                const user = headers.get("user");
                return { type: 'leave', user };
            } else if (headers.has("msg")) {
                const user = headers.get("user");
                return { type: 'msg', user, content: e.data.slice(headerEnd + 2) };
            } else {
                return { type: 'undefined', headers, content: e.data.slice(headerEnd + 2) };
            }
        } else {
            const enc = new TextDecoder();
            const data = new DataView(e.data);
            if (exports.enableDebugOutput) console.log(new Uint8Array(e.data));
            const headers = new Map();
            let pos = 0;
            let lock = 0;
            while (true) {
                let len = data.getUint16(pos);
                pos += 2;
                if (len == 0) break;
                const key = enc.decode(e.data.slice(pos, len + pos));
                pos += len;
                len = data.getUint16(pos);
                pos += 2;
                const value = new Uint8Array(e.data.slice(pos, len + pos));
                pos += len;
                headers.set(key, value);
                if (++lock == 100000) throw new Error("safety!");
            }
            if (headers.has("msg")) {
                const user = uuidb2t(headers.get("user"));
                return { type: 'msg', user, content: e.data.slice(pos) };
            } else {
                return { type: 'undefined', headers, content: e.data.slice(pos) };
            }
        }
    }

    const useWeb = typeof window !== 'undefined';

    function on(ws, event, cb) {
        if (useWeb) ws[`on${event}`] = cb;
        else ws.on(event, cb);
    }

    /**
     * Public AMX server.
     *
     * The URL is not slash-terminated.
     */
    const PUBLIC_SERVER = "https://amx.mindurka.cc";
    exports.PUBLIC_SERVER = PUBLIC_SERVER;

    let newId = 0;

    /**
     * A wrapper over @see WebSocket for easier use.
     */
    class AmxSocket {
        /**
         * Create a new @link AmxSocket.
         *
         * @param {string | URL} url AMX server URL.
         */
        constructor(url) {
            this.id = newId++;
            this.url = url;
            this.autoreconnect = true;
            this.queue = [];
            this.openConfirmed = false;
            this.ws = new WebSocket(url);

            this.ws.binaryType = 'arraybuffer';
            on(this.ws, 'open', () => {
                this.onopen();
            });
            on(this.ws, 'close', () => {
                this.openConfirmed = false;
                this.onclose();
                if (this.autoreconnect) this.reconnect();
            });
            on(this.ws, 'error', e => this.onerror(e));
            on(this.ws, 'message', m => {
                this.openConfirmed = true;
                this.onmessage(processMessage(m));
                if (!this.queue.length) return;
                const copy = this.queue;
                this.queue = [];
                copy.reverse();
                while (copy.length > 0) { // this will break if socket disconnects, but oh well.
                    const m = copy.pop();
                    this.ws.send(m);
                }
            });
        }

        /**
         * Join a room on the public server.
         *
         * @param {string} room Room name. 
         * @returns {AmxSocket} A socket connected to the room.
         */
        static publicRoom(room) {
            return new AmxSocket(`${PUBLIC_SERVER}/${encodeURIComponent(room)}`);
        }

        /**
         * Reconnect to the server.
         *
         * @param {string | URL | undefined} url 
         */
        reconnect(url) {
            if (typeof url === 'undefined') url = this.url;
            else this.url = url;

            this.openConfirmed = false;
            this.ws.close();
            this.ws.onclose = e => this.onclose(e);
            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';
            on(this.ws, 'open', () => {
                this.onopen();
            });
            on(this.ws, 'close', () => {
                this.openConfirmed = false;
                this.onclose();
                if (this.autoreconnect) this.reconnect();
            });
            on(this.ws, 'error', e => this.onerror(e));
            on(this.ws, 'message', m => {
                this.openConfirmed = true;
                this.onmessage(processMessage(m));
                if (!this.queue.length) return;
                const copy = this.queue;
                this.queue = [];
                copy.reverse();
                while (copy.length > 0) { // this will break if socket disconnects, but oh well.
                    const m = copy.pop();
                    this.ws.send(m);
                }
            });
        }

        /**
         * A message have been received.
         *
         * @param {AmxMessage} msg
         */
        onmessage(msg) { _ = msg; }
        /**
         * Socket was closed.
         */
        onclose() {}
        /**
         * Socket has connected.
         */
        onopen() {}
        /**
         * An error have occured.
         */
        onerror() {}

        /**
         * Send a message to the AMX server.
         *
         * Importantly, an AMX client can only send binary and text messages as AMX
         * protocol does not support anything else.
         *
         * @param {string | BufferSource | Blob} msg A message to send.
         */
        send(msg) {
            if (this.openConfirmed) this.ws.send(msg);
            else this.queue.push(msg);
        }

        /**
         * Close the socket.
         *
         * Will disable autoreconnect.
         */
        close() {
            this.autoreconnect = false;
            this.ws.close();
        }
    }
    exports.AmxSocket = AmxSocket;
    exports.enableDebugOutput = false;

    if (typeof window !== "undefined") {
        window.LibAMX = exports;
    }
    if (typeof module !== "undefined") {
        module.exports = exports;
    }
})();
