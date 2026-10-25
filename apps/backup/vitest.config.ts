import { defineConfig } from "vitest/config";

// UTC as in the container (TZ unset), so schedules read the same everywhere.
process.env.TZ = "UTC";

export default defineConfig({ test: { fileParallelism: false, testTimeout: 120000 } });
