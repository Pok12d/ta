const RELAY_WSS = "wss://relay-lx0q.onrender.com/intercept";

(function () {
    if (window.__unity_ws_proxy_installed) return;
    window.__unity_ws_proxy_installed = true;

    const original_SocketCreate = _SocketCreate;
    const original_SocketClose = _SocketClose;

    const webSocketInstances = [];

    function isExitGamesUrl(url) {
        try {
            const u = new URL(url, location.href);
            return /\.?exitgames\.com$/i.test(u.hostname);
        } catch (e) {
            return false;
        }
    }

    function _SocketCreateIntercept(urlPtr, protocolsPtr) {
        const urlStr = UTF8ToString(urlPtr);
        const protStr = UTF8ToString(protocolsPtr);

        // create original instance
        const instance = original_SocketCreate(urlPtr, protocolsPtr);
        const socketObj = webSocketInstances[instance] || webSocketInstances[instance];

        // replace with relay if ExitGames
        if (isExitGamesUrl(urlStr)) {
            console.log("[unity-ws-intercept] Replacing ExitGames URL with relay:", urlStr, "=>", RELAY_WSS);
            const relaySocket = new WebSocket(RELAY_WSS, protStr ? [protStr] : undefined);
            relaySocket.binaryType = "arraybuffer";

            // copy Unity callbacks
            relaySocket.onmessage = socketObj.socket.onmessage;
            relaySocket.onclose = socketObj.socket.onclose;
            relaySocket.onerror = socketObj.socket.onerror;

            // replace Unity socket
            socketObj.socket = relaySocket;
        }

        return instance;
    }

    function _SocketCloseIntercept(instance) {
        const socketObj = webSocketInstances[instance];
        if (!socketObj || !socketObj.socket) return;
        try { socketObj.socket.close(); } catch (e) { console.warn("[unity-ws-intercept] Socket close failed", e); }
    }

    // override Unity functions
    window._SocketCreate = _SocketCreateIntercept;
    window._SocketClose = _SocketCloseIntercept;

    console.log("[unity-ws-intercept] Installed ExitGames relay proxy.");
})();
