/** Linked Steam and Discord accounts, as the API gives them (the website keeps its own copy). */
export type ConnectionProvider = "steam" | "discord";
export const connectionProviders: ConnectionProvider[] = ["steam", "discord"];

export interface Connection {
  provider: ConnectionProvider;
  externalId: string;
  name: string | null;
  username: string | null;
  url: string;
  hidden: boolean;
  createdAt: string;
}

/** As a profile shows it to others. */
export type ConnectionBadge = Pick<Connection, "provider" | "name" | "username" | "url">;

export interface ConnectionSetup {
  connections: Connection[];
  available: Record<ConnectionProvider, boolean>;
}

export const providerName: Record<ConnectionProvider, string> = { steam: "Steam", discord: "Discord" };
