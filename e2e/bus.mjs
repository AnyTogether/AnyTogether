// The command bus between the scenario script and the client drivers. Each driver (the Swift
// launcher's, the phone's, the Windows/Linux launcher's) is a test in its own repository that
// long-polls here for commands, runs each with its real AnyTogether client and posts the answer.
//
//   POST /hello  {role}                       a driver is up
//   GET  /next?role=R                         the next command for R: {id, cmd, args}, or 204
//   POST /result {id, ok, value | error}      a command's answer
//
// Commands run concurrently in a driver (one may wait for an approval while another approves).
import http from "node:http";

export function createBus() {
  const queues = new Map(); // role -> commands waiting to be picked up
  const waiting = new Map(); // role -> long-poll responses waiting for a command
  const pending = new Map(); // id -> {resolve, reject, timer, role, cmd}
  const ready = new Map(); // role -> resolve
  const up = new Set();
  let next = 0;

  const queue = (role) => {
    if (!queues.has(role)) queues.set(role, []);
    return queues.get(role);
  };

  function hand(role) {
    const polls = waiting.get(role) ?? [];
    const commands = queue(role);
    while (polls.length && commands.length) {
      const res = polls.shift();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(commands.shift()));
    }
  }

  const read = (req) =>
    new Promise((resolve) => {
      let text = "";
      req.on("data", (chunk) => {
        text += chunk;
      });
      req.on("end", () => resolve(text ? JSON.parse(text) : {}));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://bus");
    if (req.method === "POST" && url.pathname === "/hello") {
      const { role } = await read(req);
      up.add(role);
      ready.get(role)?.();
      return res.writeHead(204).end();
    }
    if (req.method === "GET" && url.pathname === "/next") {
      const role = url.searchParams.get("role");
      if (!waiting.has(role)) waiting.set(role, []);
      waiting.get(role).push(res);
      const timer = setTimeout(() => {
        const polls = waiting.get(role);
        const at = polls.indexOf(res);
        if (at >= 0) {
          polls.splice(at, 1);
          res.writeHead(204).end();
        }
      }, 20_000);
      res.on("close", () => clearTimeout(timer));
      return hand(role);
    }
    if (req.method === "POST" && url.pathname === "/result") {
      const { id, ok, value, error } = await read(req);
      const call = pending.get(id);
      res.writeHead(204).end();
      if (!call) return;
      pending.delete(id);
      clearTimeout(call.timer);
      if (ok) call.resolve(value);
      else
        call.reject(
          Object.assign(new Error(`${call.role}.${call.cmd}: ${error?.message ?? error}`), {
            problem: error,
          }),
        );
      return;
    }
    res.writeHead(404).end();
  });

  return {
    server,
    listen: (port) =>
      new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port))),
    close: () => server.close(),
    /** Resolves when the driver for `role` said hello. */
    ready: (role, ms = 900_000) =>
      up.has(role)
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${role} driver never came up`)), ms);
            ready.set(role, () => {
              clearTimeout(timer);
              resolve();
            });
          }),
    isUp: (role) => up.has(role),
    /** Runs `cmd` in the `role` driver; rejects with the driver's error (a TogetherProblem's
     *  {status, code, message} where there is one). */
    call(role, cmd, args = {}, ms = 60_000) {
      const id = `c${++next}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${role}.${cmd} timed out`));
        }, ms);
        pending.set(id, { resolve, reject, timer, role, cmd });
        queue(role).push({ id, cmd, args });
        hand(role);
      });
    },
  };
}
