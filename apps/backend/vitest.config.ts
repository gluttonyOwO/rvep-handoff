import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    globalSetup: "./tests/globalSetup.ts",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    pool: "forks",    // each file gets its own process (avoids module-state conflicts)
    poolOptions: {
      forks: {
        singleFork: true,  // run all files sequentially in one fork (db is shared)
      },
    },
    env: {
      // Ensure test env picks up from globalSetup; also set dummy values for
      // keys that are validated at module load time.
      JWT_SIGNING_KEY: "dGVzdC1zaWduaW5nLWtleS10aGF0LWlzLWxvbmctZW5vdWdo",
      JWT_REFRESH_KEY: "dGVzdC1yZWZyZXNoLWtleS10aGF0LWlzLWxvbmctZW5vdWdo",
      LIVEKIT_API_KEY: "devkey",
      LIVEKIT_API_SECRET: "devsecret",
      LIVEKIT_URL: "ws://localhost:7880",
      BCRYPT_ROUNDS: "4",   // fast hashing in tests
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
