# SymB — Concept & Execution Plan

## 1. Core idea

**SymB** is a tiny black symbiote living alone in an endless white void. You are the only other thing in its universe: your cursor.

It isn't a game. There is no score, no level, no UI to manage. It's a small living creature you get to know. It starts out frightened of you and, through patience and play, slowly becomes your devoted, goofy companion. It also gets physically bigger every time it catches you.

**Design pillars**

1. **It must feel alive.** The fluid, ink-like body never sits still: it breathes, wobbles, stretches, splits off droplets and pulls them back in. All of it is procedural 2D code, with no sprites or images.
2. **Trust is earned.** Its personality grows out of how you treat it. Gentle and patient makes it bond faster. Frantic and aggressive makes it nervous.
3. **Zero friction.** Open the page and it's there. No sign-up, no tutorial screens, no buttons in your way.
4. **It remembers you.** Size, bond and history persist between visits, so coming back means something.

**Look & feel**

- **Space:** pure off-white void (`#FAFAF8`). Faint grey dust specks drift in parallax layers so you sense depth and motion, and the camera follows SymB softly, so the space never ends.
- **Creature:** glossy ink-black goo made of metaballs, so blobs merge and separate like liquid. A soft highlight gives it a little volume.
- **Face:** two white, slightly asymmetric eyes in the symbiote style, but rounded and cute. They carry most of the emotion: wide when curious, squished when happy, narrow slits when scared, closed when sleeping.
- **Tendrils:** thin goo strands that reach out, poke, grab and wrap.

---

## 2. Personality evolution (Shy → Super Friendly)

A hidden **Bond** value from 0 to 100 drives five stages. Movement and expression parameters blend smoothly between stages, so the change never feels abrupt.

| Stage | Bond | Behaviour | Catching you looks like… |
|---|---|---|---|
| **1. Shy** | 0–15 | Hides near the screen edge with only its eyes peeking out. Flees from fast movement and trembles. Creeps closer only while your cursor is still. | You hold still and it slowly creeps up and timidly touches the cursor with one tendril, then darts back. |
| **2. Curious** | 15–35 | Follows from a distance and tilts its eyes to watch you. Pokes at the cursor, and is easily startled but recovers fast. | A quick poke-and-retreat. |
| **3. Playful** | 35–60 | Actively chases you, crouches before it pounces, overshoots and tumbles. Plays tag: if you chase it, it runs off giggling (jiggling). | A real pounce. You can dodge it. |
| **4. Friendly** | 60–85 | Stays close and orbits your cursor. Wraps around it when caught, rubs against it and "purrs" (vibrating ripple). | Envelops the cursor in a little hug. |
| **5. Super Friendly** | 85–100 | Greets you excitedly when you return and searches for you when you leave. Forms a heart shape, uses several tendrils at once, and naps curled around your cursor. | Joyful, multi-tendril hug-squish. |

**What builds Bond:** time spent together, catches, petting, feeding, and holding still near it while it's shy.
**What lowers it slightly:** rapid aggressive flicking, or long neglect. The decay is small and it never drops more than half a stage, so it stays forgiving.
**Pacing target:** about 60–90 minutes of total play, spread over several visits, to reach Super Friendly. This will be tunable.

---

## 3. Interactions

| Interaction | Input | Response |
|---|---|---|
| **Chase & catch** (core loop) | Move the cursor | It steers after you and reaches out a tendril. On contact it gets a "gulp" ripple through the body, a happy eye-squish and **grows a little**. |
| **Trust by stillness** | Keep the cursor still | Mainly for the shy stage: it slowly gains courage and approaches. |
| **Petting** | Move slowly across its body | Ripples follow your path and its eyes close contentedly. A purr vibration plays, and Bond goes up. |
| **Tickle** | Fast small circles on it | Jiggly giggle-wobble and squirming. |
| **Startle** | Sudden fast flick nearby | It puffs out spikes (a nod to symbiotes), then calms down. Shy SymB flees and hides instead. |
| **Feed** | Click in empty space | Drops a small ink droplet. It notices it, wobbles over and slurps it up. This is a second way to grow. |
| **Hug** | Press and hold on it (stage 4+) | Wraps fully around the cursor and squeezes rhythmically. |
| **Leave** | Cursor leaves the window / tab hidden | It looks toward where you left. At low bond it relaxes and wanders. At high bond it waits at that edge, then dozes off. |
| **Return** | Come back | Its greeting matches the bond: a cautious peek, a happy bounce, or a sprint into a hug. |
| **Sleep** | No input for ~30 s | Slow breathing, closed eyes, tiny bubbles drifting up. Moving the cursor gently wakes it with a stretch. |
| **Budding** (when large) | Passive | Small droplets bud off, float around it and get reabsorbed, which is the "living liquid" feel. |

**Growth:** radius = `base × (1 + k·log(1 + mass))`. Growth is fast early on and slows later. As it grows, the camera gently zooms out so it never fills more than about 35% of the screen. You can still tell it's huge because the dust specks look tiny next to it.

**Touch devices:** a finger acts as the cursor. Long-press is the hug and tap is feed.

---

## 4. User flow

```
 ┌──────────────┐
 │  Open page   │  Empty white void. A faint line of text: "move gently…"
 └──────┬───────┘  (fades out after 4 s)
        ▼
 ┌──────────────────┐
 │ First encounter  │  A small black droplet drifts in from an edge and
 │ (first visit)    │  stops. Two eyes blink open. It notices you and hides.
 └──────┬───────────┘
        ▼
 ┌──────────────────┐
 │ Earning trust    │  The user learns from its reactions alone (no instructions)
 │                  │  that stillness works. First timid touch = first catch.
 └──────┬───────────┘  A tiny growth pulse confirms it.
        ▼
 ┌──────────────────────────────────────────────┐
 │ Free play loop                                │
 │  chase/catch · pet · feed · tickle · startle  │◄──────┐
 │  sleep/wake · budding                         │       │
 └──────┬──────────────────────────┬────────────┘       │
        │ bond crosses a stage     │ user leaves        │
        ▼                          ▼                    │
 ┌──────────────────┐     ┌──────────────────┐          │
 │ "Moment"         │     │ Waiting / sleep  │          │
 │ a one-time       │     │ state saved      │          │
 │ signature act,   │     └──────┬───────────┘          │
 │ e.g. first hug   │            ▼                      │
 └──────┬───────────┘     ┌──────────────────┐          │
        └────────────────►│ Return visit     │──────────┘
                          │ greeting by bond │
                          └──────────────────┘
```

**Minimal UI (corner, low opacity):** a sound toggle (🔈) and a "?" that shows a short poem-like hint list. A hidden debug panel (`?debug`) offers bond and size sliders for tuning.

---

## 5. Technical approach

- **Stack:** Vite + TypeScript, no framework. One HTML page and one `<canvas>`. Deployable as a static site (GitHub Pages / Vercel).
- **Rendering:** a WebGL2 fragment shader draws the **metaball field** from about 30–80 body particles, then thresholds it with an anti-aliased edge and adds a soft fake highlight. The eyes, dust and spikes are drawn in the same pass or a light overlay. A Canvas2D fallback (blur + alpha threshold) covers devices without WebGL2.
- **Body physics:** Verlet particles.
  - A **core** cluster with spring constraints.
  - A **membrane** ring for squash and stretch.
  - **Tendrils** as IK-like particle chains that reach toward targets.
  - Budded droplets as free particles attracted back to the core.
- **Brain:**
  - **Emotions:** fear, curiosity, joy and energy, each continuous and decaying toward a baseline.
  - **Bond:** sets the baselines and behaviour weights per stage.
  - **Steering behaviours:** seek, flee, wander, arrive, orbit, hide. Their weights are blended from emotions and bond.
  - **Small state machine** for discrete acts: Idle, Chase, Pounce, Flee, Hide, Hug, Eat, Sleep, Greet.
  - **Expression mapper:** emotions map to eye shape, wobble frequency, spikiness and tendril count.
- **Input analysis:** cursor speed, acceleration, stillness timer, circular-motion detection (tickle), slow-over-body detection (petting), and window leave/enter.
- **Persistence:** `localStorage` holds bond, mass, total catches, last-visit time and milestones unlocked, with a versioned schema.
- **Audio (optional, off by default):** procedural WebAudio sounds with no files. Squelch on catch, low purr, tiny blips for giggles.
- **Accessibility/perf:** respects `prefers-reduced-motion` (calmer wobble), DPR-aware with a resolution cap, fixed-timestep physics, and pauses when the tab is hidden. Targets 60 fps on mid-range laptops and phones.

**Planned structure**

```
src/
  main.ts            loop, resize, bootstrap
  input.ts           pointer tracking + gesture analysis
  world/camera.ts    follow + zoom-by-size
  world/dust.ts      parallax void particles
  creature/body.ts   verlet particles, membrane, tendrils, buds
  creature/brain.ts  emotions, bond, stages, state machine, steering
  creature/face.ts   eyes, blink, look-at, expressions
  render/goo.ts      WebGL2 metaball shader (+ 2D fallback)
  render/overlay.ts  eyes/spikes/hints
  save.ts            persistence
  audio.ts           procedural sounds
  debug.ts           tuning panel (?debug)
```

---

## 6. Execution plan (milestones)

Each milestone ends with something you can open in a browser and react to before the next one starts.

| # | Milestone | Deliverable / checkpoint | Size |
|---|---|---|---|
| **M0** | Scaffold | Vite + TS project, full-screen canvas, game loop, DPR handling, deploy pipeline. | S |
| **M1** | The Goo | Metaball shader with a breathing, wobbling blob made of particles. *Checkpoint: "does it look alive?"* | M |
| **M2** | Follow & Catch | Steering toward the cursor, tendril reach, catch detection, gulp ripple, growth curve, camera follow/zoom, parallax dust void. | M |
| **M3** | The Face | Eyes with blinking, look-at-cursor, squash, and an expression set (curious, happy, scared, sleepy). | S |
| **M4** | The Brain | Emotions + bond + 5 stages. Shy hiding/fleeing, stillness trust, pounce, orbit, startle spikes. Debug panel with a bond slider to preview every stage. *Checkpoint: personality review.* | L |
| **M5** | Living with it | Petting, tickle, feeding by click, hug, sleep/wake, leave/return greetings, persistence. | M |
| **M6** | Delight pass | Budding droplets, heart shape, stage-transition "moments", procedural audio, touch support. | M |
| **M7** | Polish & ship | Tuning pacing/feel, performance on mobile, reduced motion, WebGL fallback, final deploy. | S |

**Riskiest part first:** M1 (goo rendering) and M4 (believable personality) carry most of the "immersive" risk, so each gets an explicit review checkpoint.

---

## 7. Open questions

1. **Name:** is it called "SymB", or does the user name it on first visit?
2. **Sound:** include procedural audio (muted by default), or keep it fully silent?
3. **Pacing:** is ~60–90 min of total play to reach Super Friendly right, or should it be faster?
4. **Regression:** should neglect or rough play lower bond (gently), or should progress only ever go up?
5. **Size cap:** grow forever (with camera zoom), or reach a maximum adult size?
6. **Platform:** desktop-first with touch support, or equal priority on mobile?
