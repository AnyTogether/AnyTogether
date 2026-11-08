import { describe, expect, it } from "vitest";
import { deviceKindNames, deviceKindOf, publicDeviceName } from "../src/index.js";

describe("a device's kind", () => {
  it("is read from the names every app registers", () => {
    expect(deviceKindOf("AnyPS5 on Windows")).toBe("windows");
    expect(deviceKindOf("AnyPS5 on Linux")).toBe("linux");
    expect(deviceKindOf("AnyPS5 on Mac")).toBe("mac");
    expect(deviceKindOf("Chrome on Windows")).toBe("browser");
    expect(deviceKindOf("Safari on iOS")).toBe("browser");
    expect(deviceKindOf("Firefox")).toBe("browser");
  });

  it("is read from the older names that held the computer's own name", () => {
    expect(deviceKindOf("Utku's MacBook Pro · AnyPS5")).toBe("mac");
    expect(deviceKindOf("DESKTOP-7F3K2LQ")).toBe("windows");
    expect(deviceKindOf("LAPTOP-Q1W2E3")).toBe("windows");
    expect(deviceKindOf("Slick's iPhone")).toBe("iphone");
    expect(deviceKindOf("Pixel 8")).toBe("android");
    expect(deviceKindOf("steamdeck")).toBe("linux");
    // Nothing to tell from: a plain "Device", never the name.
    expect(deviceKindOf("gokalp-rig")).toBe("device");
    expect(deviceKindOf("Machine")).toBe("device");
  });

  it("names are kinds again, so a name the server gave keeps its kind", () => {
    for (const name of Object.values(deviceKindNames)) expect(publicDeviceName(name)).toBe(name);
    expect(publicDeviceName("Utku's MacBook Pro · AnyPS5")).toBe("Mac");
    expect(publicDeviceName("gokalp-rig")).toBe("Device");
  });
});
