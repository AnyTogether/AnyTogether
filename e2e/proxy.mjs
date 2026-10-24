// One origin for the whole local stack, like deploy/Caddyfile: /api to the API, /rt to the
// gateway (WebSocket upgrades too), the rest to the website. The launchers and the phone derive
// /api/v1 and /rt from one base URL, so they need this in front of the three dev servers.
//   node e2e/proxy.mjs <port> <api-port> <gateway-port> <web-port>
// Each TCP connection gets its own X-Real-IP, so a long run of sign-ins from 127.0.0.1 does not
// trip the per-address sign-in limit (30 per 15 min). Test harness only.
import http from "node:http";
import net from "node:net";

const [port, apiPort, rtPort, webPort] = process.argv.slice(2).map(Number);
if (!port || !apiPort || !rtPort || !webPort) {
  console.error("usage: node e2e/proxy.mjs <port> <api-port> <gateway-port> <web-port>");
  process.exit(2);
}
const target = (url) =>
  url.startsWith("/api/")
    ? apiPort
    : url === "/rt" || url.startsWith("/rt?") || url.startsWith("/rt/")
      ? rtPort
      : webPort;
let connections = 0;
const ipOf = (socket) => {
  if (!socket.e2eIp) socket.e2eIp = `10.77.${(++connections >> 8) & 255}.${connections & 255}`;
  return socket.e2eIp;
};

const server = http.createServer((req, res) => {
  const { "cf-connecting-ip": _, ...rest } = req.headers;
  const headers = { ...rest, "x-real-ip": ipOf(req.socket) };
  const upstream = http.request(
    { host: "127.0.0.1", port: target(req.url), method: req.method, path: req.url, headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
      answer.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`proxy: ${error.message}`);
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(target(req.url), "127.0.0.1", () => {
    const { "cf-connecting-ip": _, ...rest } = req.headers;
    const headers = { ...rest, "x-real-ip": ipOf(socket) };
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(headers))
      for (const one of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${one}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
  upstream.on("close", () => socket.end());
  socket.on("close", () => upstream.end());
});

server.listen(port, "127.0.0.1", () =>
  console.log(`proxy on 127.0.0.1:${port} -> api ${apiPort}, rt ${rtPort}, web ${webPort}`),
);
