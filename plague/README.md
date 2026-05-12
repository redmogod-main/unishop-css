# PLAGUE

A small Plague Inc-style strategy game written in vanilla HTML / CSS / JavaScript. No build step, no dependencies — open `index.html` in a browser.

## Play

Open `plague/index.html` directly, or serve the folder with any static file server:

```bash
cd plague
python3 -m http.server 8000
# then open http://localhost:8000
```

## How to play

You are a pathogen. Your goal is to wipe out humanity before the world finishes a vaccine.

1. Pick a name, starting country, and difficulty, then **Begin Infection**.
2. Click red **DNA bubbles** on the map to collect DNA points. Blue bubbles slow the cure.
3. Spend DNA in the **Disease** panel on three categories:
   - **Transmission** — how the pathogen moves between hosts (air, water, livestock, rodents, insects, birds, blood).
   - **Symptoms** — how it harms hosts. Mild symptoms boost infectivity; severe symptoms kill but attract attention.
   - **Abilities** — climate resistances and cure resistance.
4. Watch the four meters:
   - **Infectivity** drives how quickly the disease spreads inside infected nations.
   - **Severity** drives DNA bubble spawn rate, and triggers the cure once high enough.
   - **Lethality** kills hosts but also slows further spread (and bumps cure detection).
   - **Cure** is the global vaccine effort. Hit 100% and you lose.

Win condition: every human is dead.
Lose condition: the cure reaches 100%.

## Strategy tips

- Spread first, kill later. Add transmission methods and mild symptoms before evolving lethal ones — dead hosts can't infect.
- Cold countries (Greenland, Iceland, Russia, Canada) need **Cold Resistance** before the disease takes hold. Madagascar shuts its single seaport early; **Waterborne** + an early seed nearby helps.
- Once the world detects you, evolve **Drug Resistance** and **Genetic Hardening** to slow the cure.

## Files

- `index.html` — page structure (start screen, top bar, world canvas, side panel, end screen).
- `styles.css` — dark biohazard UI theme.
- `world.js` — country data (population, climate, density, wealth, borders, airports, seaports).
- `evolutions.js` — evolution tree (transmission, symptoms, abilities).
- `game.js` — game state, simulation, canvas rendering, UI bindings.

All state lives on a single `State` object in `game.js`; each tick = 1 day. The simulation is a per-country SIR-style update with stochastic cross-border / air / sea / bird seeding.
