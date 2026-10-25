/** One line per event, with the time, so `docker compose logs backup` reads as a history. */
export function log(text: string, level: "info" | "warn" | "error" = "info") {
  const line = `${new Date().toISOString()} [backup] ${level === "info" ? "" : `${level.toUpperCase()}: `}${text}`;
  if (level === "info") console.log(line);
  else console.error(line);
}
