# Rampart

A mobile-first browser remake of the arcade classic **Rampart**: wall yourself in, place cannons, and bombard your rivals. It runs on **Cloudflare Workers + Durable Objects** and needs nothing but a phone browser to play.

- **Campaign vs the Fleet**: single player, six levels of warships (and landing troops) attacking your coast in waves, on Easy, Normal or Hard. The **Endless Siege** keeps the waves coming until your walls fall, and your best run is saved.
- **Battle the Computer**: you against 1-3 computer commanders (easy / normal / hard).
- **Play Online**: 2-4 players in a room, from anywhere. Empty seats can be filled with computer players, and if someone's connection drops, a computer takes over their seat until they return.

## How to play

1. **Choose a castle.** Tap a castle in your land; a wall is built around it for you.
2. **Place cannons** inside your walls. Every enclosed castle gives you one cannon each round, and your home castle gives two (as long as there's room).
3. **Fire!** Tap where you want a cannonball to land. Balls are lobbed: long shots fly high and take a while to land (a cannon can't fire again until its ball lands), so every shot counts. Lead moving ships. Knock holes in enemy walls and wreck enemy cannons.
4. **Build & repair.** Tetris-like wall pieces appear. Close wall loops around castles to claim them. Any area that isn't fully enclosed when combat ends is lost, along with its cannons.
5. **Fill craters.** Missed shots leave craters that block building for two rounds. In each build phase you can tap **3 craters** in your land to shovel them flat (they glow while you have shovels left).

If none of your castles are enclosed after a build phase, you're out. In a battle, the last commander standing (or the highest score after the final round) wins and chooses the losers' fate: **pelted with tomatoes** in the stocks, **walk the plank**, **beheading**, **launched by trebuchet**, **fed to the dragon**, the **ducking stool**, or demoted to **court jester**. Win the campaign and you choose the Pirate Admiral's fate; lose it and the pirates choose yours.

**The fleet** arrives in waves (a war horn sounds each time). Galleons fire broadsides in later levels, and on Normal and Hard the **pirate flagship** (black sails, six hits to sink) leads the final wave of a level.

**Factions** are cosmetic, but each has its own walls and stronghold: the Kingdom's stone keep, a Norse timber longhall behind a log palisade, a Sultanate sandstone palace, a Shogunate pagoda castle, an Aztec sun temple, and a Celtic hill fort. Pick yours on the home screen (or tap your faction badge in an online lobby). Your colour still shows on banners, domes and wall trim.

Scoring: points for walls, cannons and ships you destroy, plus a bonus after each build phase for castles held, enclosed land, captured **bonus squares** (gold gems), and a **clean-territory** bonus when there are no craters or grunts inside your walls.

**The battle report.** When a game ends, everyone's stats are shown side by side (the best in each row in gold): score, castles held, walls destroyed and lost, cannons placed, cannonballs fired, walls hit per shot, cannons wrecked, largest castle area and craters filled. Against the fleet you see ships sunk, hit rate and troops squashed instead.

### Accounts, honours and cosmetics

Create an account (a commander name and a password) from the home screen and your record follows you to any device: games and wins in every mode, best scores, career totals of every stat, and your recent games. Your **profile** has four tabs: *Record*, *Honours*, *Armoury* and a *Hall of Fame* ranking every commander by wins.

There are 23 **honours** (achievements), such as *Wall Breaker* (75 walls in one battle), *Flagship Down*, *Impregnable* (win losing at most 15 walls), *Giant Slayer* (beat three Hard computers at once) and *Cruel and Unusual* (hand out every punishment). Each one unlocks a cosmetic, worn from the Armoury:

- **Titles** shown after your name, in the lobby and the finale ("Sam the Wall-Breaker").
- **Victory hats** your commander wears in the finale: the admiral's tricorn, a great helm, a horned helm, a laurel wreath, the headsman's hood, a wizard's hat and the fool's cap.
- **Cannonball trails** that everyone sees online: black powder smoke, Greek fire, gilded sparks and arcane wisps.

Online games are recorded by the server; campaign and computer battles are sent by your browser when the game ends (and queued if you are offline). You can play as a guest without an account, but nothing is saved.

### Controls

| | Phone / tablet | Desktop |
|---|---|---|
| Move a piece or cannon | Drag anywhere (it moves like a trackpad) | Mouse |
| Place it | Tap the piece (tap elsewhere to jump it there) | Click |
| Rotate | ⟳ button or two-finger tap | Right-click, mouse wheel, `R` |
| Fire | Tap the target (use several fingers for rapid fire) | Click |
| Fill a crater | Tap it (build phase) | Click it, or `F` under the piece |
| Zoom | 🔍 button | 🔍 button |

In Settings you can switch touch controls to **Direct** mode, where the piece follows your finger (drawn just above it) and drops when you lift your finger. Landscape works best on phones, but portrait works too. The game can be added to the home screen as an app, and single-player modes work offline.

## Architecture

```
src/shared/   game rules, deterministic engine, AI, map generator, wire protocol, careers and honours (runs in the browser AND the Durable Objects)
src/server/   Cloudflare Worker (routing, accounts API, static assets), the GameRoom and Accounts Durable Objects
src/client/   canvas renderer, pixel-art sprites, touch/mouse/keyboard input, HUD, sounds
public/       index.html, CSS, manifest, service worker; the client bundle (app.js) is built here
test/         vitest unit tests (engine, AI planner, map generation, protocol sync)
```

- **One Durable Object per room code.** It holds the lobby, runs the authoritative simulation at 20 ticks/s, and streams compact deltas (changed tiles, new cannonballs, events) over WebSockets. Clients animate cannonballs and ships locally between ticks, and show their own wall placements optimistically.
- **Solo and vs-computer games run entirely in the browser** using the same engine, so they cost nothing on the server and work offline.
- **Accounts** live in a second SQLite-backed Durable Object (`Accounts`, one instance for everyone). Passwords are hashed with PBKDF2, sessions are random bearer tokens (stored hashed), and repeated wrong passwords lock an account for five minutes. The game rooms look up signed-in players when they join and save each online result when the game ends.
- **The computer players** choose a target territory, then compute the exact wall tiles needed with a minimum vertex cut (max-flow), which lets them route around craters and reuse old walls. They shovel craters that are in the way, aim at breach points in enemy walls and lead moving ships.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev          # builds the client and serves everything at http://localhost:8787
npm test             # unit tests
npm run typecheck
npm run sim -- versus 4 123   # headless AI-vs-AI game, useful for balancing (DRAW=1 prints the map)
npm run campaign-sim -- 6     # how computer defenders fare against each campaign difficulty
```

To try multiplayer on your phone while developing, run `npx wrangler dev --ip 0.0.0.0` and open `http://<your-computer's-LAN-IP>:8787` on phones on the same Wi-Fi.

## Deploy to Cloudflare

The app is a single Worker with static assets and one Durable Object class (SQLite-backed, so it works on the **free Workers plan**). You can deploy it in either of these ways.

### Option A: connect the GitHub repo in the Cloudflare dashboard (recommended)

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**, and pick this repository.
2. Keep the defaults: build command empty (the `build` step in `wrangler.jsonc` bundles the client automatically), deploy command `npx wrangler deploy`.
3. Deploy. Your game will be live at `https://rampart.<your-subdomain>.workers.dev`. Every push to the production branch redeploys it.

### Option B: deploy from your computer

```bash
npm install
npx wrangler login
npm run deploy
```

### Option C: GitHub Actions

`.github/workflows/ci.yml` typechecks, tests and builds every push. On pushes to `main` it also deploys, once you add these repository secrets:

- `CLOUDFLARE_API_TOKEN`: an API token created from the **Edit Cloudflare Workers** template.
- `CLOUDFLARE_ACCOUNT_ID`: your account ID (shown on the Workers & Pages overview page).

To use your own domain, add a **Custom Domain** under the Worker's *Settings → Domains & Routes*.

### Capacity and cost

Each room is one Durable Object instance that exists only while players are connected (it shuts down 90 seconds after everyone leaves). A 4-player game sends roughly 20 small messages per second to each player. That is far inside the free plan's limits for a handful of concurrent players.

Accounts need no extra setup: the `Accounts` Durable Object is created by the `v2` migration in `wrangler.jsonc` on the next deploy. To keep sign-in within the free plan's CPU budget, passwords use 25,000 PBKDF2 rounds (`PBKDF2_ITERATIONS` in `src/server/accounts.ts`); on the paid plan you can raise it, and existing passwords are re-hashed the next time their owner signs in.

## Tuning

Phase lengths, scoring, cannonball flight (`flightTime`), crater shovels and the campaign's levels, waves and difficulty scaling (`levelDef`) are in `src/shared/constants.ts`. AI skill levels are at the top of `src/shared/ai.ts`. Faction pixel art is in `src/client/factions.ts` and the finale scenes (and victory hats) in `src/client/execution.ts`. Honours, their thresholds and the cosmetics they unlock are in `src/shared/career.ts`.
