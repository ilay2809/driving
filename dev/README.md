# Dev harness pages

Put standalone HTML pages here (e.g. `world-viewer.html`, `vehicle.html`, `ui.html`) that
load a module in isolation: `<script type="module" src="/src/dev/<name>.ts"></script>`.
They are served at `/dev/<name>.html` by `pnpm dev` and built with `pnpm build`
(`dist/dev/<name>.html`), so Playwright can screenshot them headlessly.
