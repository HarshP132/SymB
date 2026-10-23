# SymB

A tiny black symbiote living in an endless white void. It's a digital pet: it chases your cursor, grows every time it catches you, and slowly goes from shy to super friendly.

See [PLAN.md](PLAN.md) for the concept, interactions and roadmap.

## Run

```sh
npm install
npm run dev          # opens http://localhost:5173/ in your browser
npm run dev:debug    # same, with the debug readout: http://localhost:5173/#debug
npm run dev:phone    # also serves on your Wi-Fi; open the "Network" URL on your phone
npm run build        # typecheck + production build into dist/
```

Add `?debug` (or `#debug`) to the URL for an FPS readout. In debug mode, `g` grows SymB by 1 mass, `G` by 25, and `r` resets it. Keys `1`–`4` preview expressions (curious, happy, scared, sleepy) and `0` returns to automatic.
