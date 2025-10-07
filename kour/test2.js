

const RELAY_WSS = "wss://relay-lx0q.onrender.com/intercept"; 

;(function(){
  if (window.__exitgames_ws_proxy_installed) return;
  window.__exitgames_ws_proxy_installed = true;

  // ---- helpers for base64 <-> ArrayBuffer ----
  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // ---- persistent control socket to relay ----
  let relay;
  let readyPromiseResolve;
  let readyPromise = new Promise((res) => { readyPromiseResolve = res; });
  const pendingQueue = []; // messages queued while relay not open

  function connectRelay() {
    relay = new WebSocket(RELAY_WSS);
    relay.binaryType = "arraybuffer";
    relay.addEventListener("open", () => {
      console.log("[proxy-client] relay connected");
      readyPromiseResolve();
      // flush queue
      while (pendingQueue.length) relay.send(JSON.stringify(pendingQueue.shift()));
    });
    relay.addEventListener("message", (ev) => {
      // all relay <-> client control messages are JSON text
      let msg;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data)); }
      catch (e) { console.error("[proxy-client] invalid relay message", e); return; }

      const { type, connId, payload, reason, code } = msg;
      const stub = stubs.get(connId);
      if (!stub) {
        console.warn("[proxy-client] unknown connId", connId, msg);
        return;
      }

      if (type === "open") {
        stub._readyState = 1; // OPEN
        if (typeof stub.onopen === "function") stub.onopen({ target: stub });
        stub.dispatchEvent && stub.dispatchEvent(new Event("open"));
      } else if (type === "message") {
        // payload may be text or base64 binary (with .isBinary flag)
        if (msg.isBinary) {
          const ab = base64ToArrayBuffer(payload);
          const evObj = { data: ab };
          if (typeof stub.onmessage === "function") stub.onmessage(evObj);
          stub.dispatchEvent && stub.dispatchEvent(Object.assign(new Event("message"), evObj));
        } else {
          const evObj = { data: payload };
          if (typeof stub.onmessage === "function") stub.onmessage(evObj);
          stub.dispatchEvent && stub.dispatchEvent(Object.assign(new Event("message"), evObj));
        }
      } else if (type === "close") {
        stub._readyState = 3; // CLOSED
        const evObj = { code: code || 1000, reason: reason || "server closed" };
        if (typeof stub.onclose === "function") stub.onclose(evObj);
        stub.dispatchEvent && stub.dispatchEvent(Object.assign(new Event("close"), evObj));
        stubs.delete(connId);
      } else if (type === "error") {
        const evObj = { message: msg.message || "relay error" };
        if (typeof stub.onerror === "function") stub.onerror(evObj);
        stub.dispatchEvent && stub.dispatchEvent(Object.assign(new Event("error"), evObj));
      }
    });
    relay.addEventListener("close", () => {
      console.warn("[proxy-client] relay closed, will reconnect in 2s");
      // notify all stubs
      for (const [connId, stub] of stubs) {
        if (stub._readyState !== 3) {
          stub._readyState = 3;
          typeof stub.onclose === "function" && stub.onclose({ code: 1006, reason: "relay disconnected" });
          stub.dispatchEvent && stub.dispatchEvent(Object.assign(new Event("close"), { code:1006, reason:"relay disconnected" }));
        }
      }
      setTimeout(connectRelay, 2000);
      // create new ready promise
      readyPromise = new Promise((res) => { readyPromiseResolve = res; });
    });
    relay.addEventListener("error", (e) => {
      console.error("[proxy-client] relay error", e);
      try { relay.close(); } catch(e){}
    });
  }
  connectRelay();

  function sendControl(obj) {
    const s = JSON.stringify(obj);
    if (relay && relay.readyState === WebSocket.OPEN) {
      try { relay.send(s); } catch (e) { pendingQueue.push(obj); }
    } else {
      pendingQueue.push(obj);
    }
  }

  // ---- manage multiple stub sockets ----
  const stubs = new Map(); // connId => stub
  let nextConnId = 1;
  function genConnId(){ return "c" + (nextConnId++); }

  // ---- helper to detect exitgames hosts ----
  function isExitGamesUrl(url) {
    try {
      const u = new URL(url, location.href);

    console.log(/\.?exitgames\.com$/i.test(u.hostname))
      
      return /\.?exitgames\.com$/i.test(u.hostname);
    } catch (e) { return false; }
  }

  // ---- Override WebSocket constructor ----
  const NativeWebSocket = window.WebSocket;

  function ProxyWebSocket(url, protocols) {
    // If not exitgames target, return native
    try {
      if (!isExitGamesUrl(url)) {
        return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      }
    } catch (e) {
      console.error("[proxy-client] URL parse error", e);
      return new NativeWebSocket(url, protocols);
    }

    const connId = genConnId();
    const stub = new EventTarget(); // we will attach convenience props below
    stub._connId = connId;
    stub._url = url;
    stub._protocols = protocols;
    stub._readyState = 0; // CONNECTING

    // convenience callbacks
    stub.onopen = null;
    stub.onmessage = null;
    stub.onclose = null;
    stub.onerror = null;

    // event target compatibility: addEventListener/removeEventListener/dispatchEvent already from EventTarget

    // send / close
    stub.send = function(data) {
      if (stub._readyState === 3) {
        throw new Error("WebSocket is closed");
      }
      // handle string vs binary
      if (typeof data === "string") {
        sendControl({ type: "send", connId, isBinary: false, payload: data });
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        const ab = data instanceof ArrayBuffer ? data : data.buffer;
        const b64 = arrayBufferToBase64(ab);
        sendControl({ type: "send", connId, isBinary: true, payload: b64 });
      } else if (data instanceof Blob) {
        // read blob as arraybuffer
        const reader = new FileReader();
        reader.onload = function() {
          const ab = reader.result;
          const b64 = arrayBufferToBase64(ab);
          sendControl({ type: "send", connId, isBinary: true, payload: b64 });
        };
        reader.readAsArrayBuffer(data);
      } else {
        // fallback stringify
        try { sendControl({ type: "send", connId, isBinary:false, payload: JSON.stringify(data) }); }
        catch(e){ console.warn("[proxy-client] unknown send type", e); }
      }
    };

    stub.close = function(code, reason) {
      if (stub._readyState === 3) return;
      stub._readyState = 3;
      sendControl({ type: "close", connId, code: code || 1000, reason: reason || "client close" });
      // fire close locally
      typeof stub.onclose === "function" && stub.onclose({ code: code || 1000, reason: reason || "client close" });
      stub.dispatchEvent && stub.dispatchEvent(Object.assign(new Event("close"), { code: code || 1000, reason: reason || "client close" }));
      stubs.delete(connId);
    };

    // Register stub and request server to open target
    stubs.set(connId, stub);
    // wait for relay ready then send open request
    readyPromise.then(()=> {
      sendControl({ type: "open", connId, target: url, protocols: protocols });
    });

    // Return stub that mostly looks like WebSocket
    Object.defineProperty(stub, "readyState", { get: () => stub._readyState });
    Object.defineProperty(stub, "url", { get: () => stub._url });
    Object.defineProperty(stub, "protocol", { get: () => stub._protocols });

    return stub;
  }

  // Ensure ProxyWebSocket.prototype matches native to keep 'instanceof' false but usable
  ProxyWebSocket.prototype = NativeWebSocket.prototype;

  // Replace global WebSocket
  window.WebSocket = ProxyWebSocket;

  console.log("[proxy-client] installed exitgames ws proxy. Relay:", RELAY_WSS);
})();
