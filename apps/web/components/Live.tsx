"use client";

import type { LiveEvent } from "@/lib/social";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Status = "connecting" | "ready" | "offline";
type Listener = (event: LiveEvent) => void;

interface Live {
  me: string;
  /** This browser's session, which the gateway and calls name its device. */
  session: string | null;
  status: Status;
  send: (frame: object) => boolean;
  subscribe: (listener: Listener) => () => void;
}

const LiveContext = createContext<Live | null>(null);

/** IDs the API gives events, which a reconnecting socket can resume after. */
const resumable = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One gateway socket for the whole signed-in website: opened with a one-time ticket, kept alive
 *  with heartbeats, reconnected with back-off, resumed from the last event. */
export function LiveProvider({ me, children }: { me: string; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [session, setSession] = useState<string | null>(null);
  const listeners = useRef(new Set<Listener>());
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let lastId: string | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let beat: ReturnType<typeof setInterval> | undefined;

    const presence = () => ({ state: document.hidden ? "away" : "online" });
    const heartbeat = () => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ op: "heartbeat", presence: presence() }));
    };

    async function connect() {
      if (stopped) return;
      setStatus("connecting");
      const response = await fetch("/me/realtime", { method: "POST" }).catch(() => undefined);
      if (response?.status === 401 || response?.status === 403) return setStatus("offline");
      if (!response?.ok) return later();
      const { ticket, url } = (await response.json()) as { ticket: string; url: string | null };
      const target = url ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rt`;
      const ws = new WebSocket(target);
      socket.current = ws;
      ws.onopen = () =>
        ws.send(
          JSON.stringify({ op: "hello", ticket, client: "web/0.1", ...(lastId ? { resume: lastId } : {}) }),
        );
      ws.onmessage = (message) => {
        let frame: {
          op: string;
          id?: string;
          type?: string;
          data?: unknown;
          session?: string;
          heartbeat?: number;
        };
        try {
          frame = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (frame.op === "ready") {
          attempt = 0;
          setSession(frame.session ?? null);
          setStatus("ready");
          clearInterval(beat);
          beat = setInterval(heartbeat, (frame.heartbeat ?? 25) * 1000);
          for (const listener of listeners.current) listener({ id: "", type: "live.ready", data: null });
          return;
        }
        if (frame.op === "event" && frame.type) {
          if (frame.id && resumable.test(frame.id)) lastId = frame.id;
          const event = { id: frame.id ?? "", type: frame.type, data: frame.data } as LiveEvent;
          for (const listener of listeners.current) listener(event);
        }
      };
      ws.onclose = (closed) => {
        clearInterval(beat);
        if (socket.current === ws) socket.current = null;
        setStatus("offline");
        // Signed out elsewhere, or the sign-in is gone: stop until the page reloads.
        if (closed.code === 4003) return;
        later();
      };
    }

    function later() {
      if (stopped) return;
      setStatus("offline");
      const wait = Math.min(30_000, 1000 * 2 ** attempt++) * (0.75 + Math.random() * 0.5);
      retry = setTimeout(connect, wait);
    }

    const visibility = () => heartbeat();
    document.addEventListener("visibilitychange", visibility);
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", visibility);
      socket.current?.close(1000, "page closed");
    };
  }, []);

  const send = useCallback((frame: object) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(frame));
    return true;
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return (
    <LiveContext.Provider value={{ me, session, status, send, subscribe }}>{children}</LiveContext.Provider>
  );
}

export function useLive() {
  const live = useContext(LiveContext);
  if (!live) throw new Error("useLive outside LiveProvider");
  return live;
}

/** Calls `handler` for every gateway event (and "live.ready" after each (re)connect). */
export function useLiveEvents(handler: Listener) {
  const { subscribe } = useLive();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}
