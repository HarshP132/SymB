# SymB

A tiny black symbiote living in an endless white void. It's a digital pet: it chases your cursor, grows every time it catches you, and slowly goes from shy to super friendly.

See [PLAN.md](PLAN.md) for the concept, interactions and roadmap.

SymB remembers its bond and size in your browser (localStorage).

## Playing with SymB

- **Move** around: it watches you, and (once it trusts you) chases and catches your cursor.
- **Hold still** near a shy SymB: it slowly gathers courage and comes to you.
- **Stroke** it slowly to pet it; **circle** quickly on it to tickle it.
- **Click / tap** empty space to drop food; click it to boop it.
- **Press and hold** on it for a hug (once it's friendly).
- **Leave** for a while and it falls asleep; come back gently and it wakes with a stretch.

## Run

```sh
npm install
npm run dev          # opens http://localhost:5173/ in your browser
npm run dev:debug    # same, with the debug readout: http://localhost:5173/#debug
npm run dev:phone    # also serves on your Wi-Fi; open the "Network" URL on your phone
npm run build        # typecheck + production build into dist/
```

Add `?debug` (or `#debug`) to the URL for an FPS readout. In debug mode, `g` grows SymB by 1 mass, `G` by 25, and `r` resets it. `Shift+R` starts over with a brand-new shy SymB, `[` / `]` change bond by 5, and a slider at the bottom jumps between personality stages. Keys `1`–`4` preview expressions (curious, happy, scared, sleepy) and `0` returns to automatic.
