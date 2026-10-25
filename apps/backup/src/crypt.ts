import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Step, run } from "./proc.js";
import type { Encryption } from "./settings.js";

/** The file name ending each method adds. */
export const suffix = { age: ".age", gpg: ".gpg", none: "" } as const;

/** A gpg home for one run, and its removal: the agent gpg starts there is stopped as well. Under
 *  the system's temporary folder, since the agent's socket path has a length limit. */
export async function gpgHome(): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "gpg-"));
  return {
    dir,
    async remove() {
      await run({ cmd: "gpgconf", args: ["--homedir", dir, "--kill", "gpg-agent"] }).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** gpg wants a home of its own; a fresh one per run keeps nothing behind. */
const gpgBase = (home: string) => ["--homedir", home, "--batch", "--yes", "--no-tty", "--quiet"];

/** The program that encrypts a stream, or none. */
export function encryptStep(encryption: Encryption, gpgHome: string): Step | null {
  switch (encryption.method) {
    case "age":
      return { cmd: "age", args: encryption.recipients.flatMap((key) => ["-r", key]) };
    case "gpg":
      return {
        cmd: "gpg",
        args: [
          ...gpgBase(gpgHome),
          "--pinentry-mode",
          "loopback",
          "--passphrase-fd",
          "3",
          "--symmetric",
          "--cipher-algo",
          "AES256",
          // The dump and the archive are compressed already.
          "--compress-algo",
          "none",
          "--output",
          "-",
        ],
        fd3: encryption.passphrase,
      };
    case "none":
      return null;
  }
}

/** The program that decrypts a stream encrypted with `method`. */
export function decryptStep(
  method: Encryption["method"],
  keys: { ageIdentityFile: string; passphrase: string },
  gpgHome: string,
): Step | null {
  switch (method) {
    case "age":
      if (!keys.ageIdentityFile)
        throw new Error(
          "this backup is encrypted with age: set BACKUP_AGE_IDENTITY_FILE to the private key file (mount it into the container)",
        );
      return { cmd: "age", args: ["--decrypt", "-i", keys.ageIdentityFile] };
    case "gpg":
      if (!keys.passphrase)
        throw new Error("this backup is encrypted with a passphrase: set BACKUP_PASSPHRASE (or _FILE)");
      return {
        cmd: "gpg",
        args: [
          ...gpgBase(gpgHome),
          "--pinentry-mode",
          "loopback",
          "--passphrase-fd",
          "3",
          "--decrypt",
          "--output",
          "-",
        ],
        fd3: keys.passphrase,
      };
    case "none":
      return null;
  }
}
