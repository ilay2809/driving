# Preview ports

`playwright.config.ts` derives a unique preview port per checkout (hash of the working
directory, 4300–4699) and never reuses a server it did not start, so parallel worktrees do
not collide on port 4173. Custom screenshot scripts must do the same: start their own
`pnpm exec vite preview --port <free port> --strictPort` (or import `PREVIEW_PORT` from
playwright.config.ts) instead of assuming 4173.
