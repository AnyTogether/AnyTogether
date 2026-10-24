/** The compatibility list as the API shows it (the website keeps its own copy of the shapes). */
export type CompatStatus = "nothing" | "boots" | "menus" | "ingame" | "playable";
export type CompatPlatform = "macos" | "windows" | "linux";
export const compatStatuses: CompatStatus[] = ["playable", "ingame", "menus", "boots", "nothing"];
export const compatPlatforms: CompatPlatform[] = ["macos", "windows", "linux"];
export const platformNames: Record<CompatPlatform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

export interface CompatSummary {
  status: CompatStatus;
  version: string;
  testedAt: string;
  reports: number;
}

export interface CompatGame {
  titleId: string;
  name: string | null;
  names: Record<string, string>;
  iconUrl: string | null;
  platforms: Partial<Record<CompatPlatform, CompatSummary>>;
}

export interface CompatReportView {
  id: string;
  platform: CompatPlatform;
  status: CompatStatus;
  launcherVersion: string;
  engineVersion: string | null;
  gameVersion: string | null;
  machine: string | null;
  os: string | null;
  fpsAvg: number | null;
  note: string | null;
  createdAt: string;
  mine: boolean;
}

export const isTitleId = (value: string) => /^[A-Z]{4}[0-9]{5}$/.test(value);
