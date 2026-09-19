# Changelog

## 2.0.0

- Migrate the complete runtime to strict TypeScript 7; ship declarations and support CommonJS / ESM imports with no runtime dependencies.
- Add explicit channel opening for server-first protocols and preserve TCP half-close semantics.
- Fix channel ID reuse, stale listener retention, repeated close notifications, reconnection cleanup, and target connection failures.
- Bound frames and connections, validate configuration and protocol messages, add backpressure and handshake timeouts.
- Add awaitable server startup, idempotent shutdown, readiness/error events, bind-address controls, and a forwarding-port allowlist.
- Add TCP integration, framing, release-recovery, and installed-package tests, Biome checks, and dependency updates.
- Automate npm OIDC publishing of the tested tarball, integrity verification and GitHub Release recovery.

Breaking: requires Node >=22.18; client and server must both use v2. Private lib/* imports are no longer exported. Server startup errors now reject init().
