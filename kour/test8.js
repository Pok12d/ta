// ==Unity WebSocket ExitGames WSS Intercept==

;(function() {
  if (window.__unity_ws_intercept_installed) return;
  window.__unity_ws_intercept_installed = true;

  const RELAY_WSS = "wss://relay-lx0q.onrender.com/intercept"; // change to your relay

  // keep a reference to Unity's original _SocketCreate
  const original_SocketCreate = window._SocketCreate;
  const webSockets = window.webSocketInstances;

  function isExitGamesUrl(url) {
    try {
      const u = new URL(url, location.href);
      return /\.?exitgames\.com$/i.test(u.hostname);
    } catch(e) { return false; }
  }

  // Override Unity _SocketCreate
  window._SocketCreate = function(urlPtr, protPtr) {
    let url = UTF8ToString(urlPtr);
    let prot = UTF8ToString(protPtr);

    // Replace only ExitGames WSS
    const replaced = isExitGamesUrl(url);
    if (replaced) {
      console.log("[unity-ws-intercept] Replacing ExitGames WSS:", url, "→", RELAY_WSS);
      url = RELAY_WSS;
      urlPtr = stringToUTF8(url); // convert new URL back to pointer
    }

    const instance = original_SocketCreate(urlPtr, protPtr);
    const socketObj = webSockets[instance];

    // Wrap the underlying socket if we replaced the URL
    if (replaced && socketObj) {
      const originalSocket = socketObj.socket;
      socketObj.socket = new Proxy(originalSocket, {
        get(target, prop) {
          if (prop === "send") {
            return function(data) {
              // Optional: transform or log outgoing messages here
              return target.send(data);
            };
          }
          if (prop === "close") {
            return function(code, reason) {
              // Optional: intercept close
              return target.close(code, reason);
            };
          }
          return target[prop];
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        }
      });
    }

    return instance;
  };

  console.log("[unity-ws-intercept] Installed ExitGames WSS intercept, relay:", RELAY_WSS);
})();
