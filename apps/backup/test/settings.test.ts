import { describe, expect, it } from "vitest";
import { settings } from "../src/settings.js";

const base = { DATABASE_URL: "postgres://x@localhost/x" };
const key = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";

describe("settings", () => {
  it("has the documented defaults", () => {
    const s = settings(base);
    expect(s.schedule.source).toBe("0 3 * * *");
    expect(s.retention).toEqual({ daily: 7, weekly: 4, monthly: 3 });
    expect(s.localDir).toBe("/backups");
    expect(s.remote).toBe("");
    expect(s.encryption.method).toBe("none");
  });

  it("picks age with recipients, gpg with a passphrase, and refuses both", () => {
    expect(
      settings({ ...base, BACKUP_AGE_RECIPIENTS: `${key}, ssh-ed25519 AAAAC3Nz me@host` }).encryption,
    ).toEqual({
      method: "age",
      recipients: [key, "ssh-ed25519 AAAAC3Nz me@host"],
    });
    expect(settings({ ...base, BACKUP_PASSPHRASE: "long words" }).encryption.method).toBe("gpg");
    expect(() => settings({ ...base, BACKUP_AGE_RECIPIENTS: key, BACKUP_PASSPHRASE: "x" })).toThrow(
      /not both/,
    );
    expect(() => settings({ ...base, BACKUP_AGE_RECIPIENTS: "AGE-SECRET-KEY-1XYZ" })).toThrow(/not an age/);
    expect(() => settings({ ...base, BACKUP_ENCRYPTION: "age" })).toThrow(/needs/);
  });

  it("reads the remote, local copies and retention", () => {
    const s = settings({
      ...base,
      BACKUP_REMOTE: "offsite:anytogether/",
      BACKUP_KEEP_LOCAL: "false",
      BACKUP_KEEP_DAILY: "14",
      BACKUP_SCHEDULE: "30 2 * * *",
    });
    expect(s.remote).toBe("offsite:anytogether");
    expect(s.localDir).toBe("");
    expect(s.retention.daily).toBe(14);
    expect(() => settings({ ...base, BACKUP_KEEP_WEEKLY: "-1" })).toThrow(/whole number/);
    expect(() => settings({})).toThrow(/DATABASE_URL/);
  });
});
