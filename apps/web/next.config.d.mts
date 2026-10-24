import type { NextConfig } from "next";

declare const config: NextConfig & { headers: NonNullable<NextConfig["headers"]> };
export default config;
