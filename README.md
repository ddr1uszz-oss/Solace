# Solace

A browser card game inspired by Roblox *Twenty One*. You vs. computer players, with all 37 rune cards from your Canva art implemented, a synthesized sound track, and animated effects.

**Stack:** plain HTML + CSS + ES modules. No build step, no dependencies. Fonts load from Google Fonts (falls back to system serif offline).

## Run it

Single-player and online both run from the Node server (it serves the game files too):

```
npm install
npm start                        # http://localhost:8080  (PORT env var respected)
```

"Begin" is single-player vs computers. "Play online with friends" opens the lobby: one player creates a room and shares the 4-letter code, friends join, the host can add computer players and set starting lives, then starts. A refresh or dropped connection puts you back in your seat within the reconnect grace period (20 s by default); after that a player who is still gone is **eliminated** (the host can switch this to "computer takes over"; see Disconnects). Idle humans are auto-stood after 60 s so nobody stalls the table.

## Deploy online (Render)

1. Put the contents of this folder at the root of a GitHub repo (`server.js`, `package.json`, `js/`, ... at the top level, not inside another folder).
2. Render: New > **Web Service** > connect the repo. Runtime **Node**, build command `npm install`, start command `node server.js`. Free plan works (sleeps when idle; first visit after a nap takes ~30 s).
3. Open the Render URL on every device. Rooms live in server memory, so a redeploy or restart ends active games.

Tunables (environment variables): `SOLACE_AI_DELAY`, `SOLACE_RUNE_PAUSE`, `SOLACE_TURN_MS` (default turn timer for new rooms, 60000 = 60 s), `SOLACE_DROP_MS`.

## Table rules (configurable, stored in the game config, shared online)

Set on the start screen (single player) or by the host in the online lobby; everyone sees them in the lobby. In code they are `js/engine/config.js`:

| Option | Values | Default |
| --- | --- | --- |
| `turnDirection` | `cw` clockwise, `ccw` counter-clockwise, `alternate` (flips every round) | `alternate` |
| `turnTimer` | seconds per turn / vote / pick (0 = off). When it runs out the game stands / votes / picks for that human. After a round, un-ready humans are readied after 20 s. | 0 (online rooms: 60) |
| `showDirection` | `true` / `false`. Off hides the turn-direction indicator and never sends the direction to clients (opponents are listed in fixed seat order). The game still runs in that direction, and Reverse still announces itself | `true` |
| `showLives` | `true` / `false`. Off: you only see your own lives; opponents show `?` (seats, player list, choose-a-player sheets, round results). All lives are revealed when the game ends. Hidden server-side, in `getView` | `true` |
| `showRuneCount` | `true` / `false`. On: you can see how many rune cards each opponent holds. Off: that number is hidden (your own is always shown) | `true` |
| `runeHandLimit` | 2..10, how many rune cards each player can hold (Tight Grip can only lower it for a round) | 6 |
| `runeDrawChance` | 0..1, chance that a normal draw also gives a free rune (never over the hand limit) | 0.25 |

**Scoring, deck sizes and disconnects** (all in `js/engine/config.js`; the lobby and start screen render them from `js/engine/options.js`, and the server validates them from the same list):

| Option | Values | Default |
| --- | --- | --- |
| `lossFrac` | `null` = classic (only the closest player(s) are safe). `0..1` = the worst `lossFrac` of the table lose lives equal to the bet | `null` |
| `lossRounding` | `ceil` / `round` / `floor`: how `lossFrac x players` becomes a head count | `ceil` |
| `lossTies` | `lose`: players tied at the cutoff all lose. `safe`: they are spared (unless that would leave nobody losing) | `lose` |
| `unitDeckScaling` | `scaled`: copies of the 1-11 set grow with the table. `fixed`: always `unitCopies` | `scaled` |
| `playersPerDeck`, `minUnitCopies`, `maxUnitCopies`, `unitCopies` | `scaled`: copies = ceil(living players / playersPerDeck), clamped to min/max (1v1 = one set, 3-4 players = 2, 5-6 = 3 ...) | 2, 1, 0 (no cap), 1 |
| `runeDeckMultiplier` | `'auto'` or a number: multiplies every rune's copies. `auto` uses `runeDeckAuto` | `auto` |
| `runeDeckAuto` | tiers as `[minPlayers, multiplier]`; `[[8, 2]]` doubles the rune deck at 8-10 players | `[[8, 2]]` |
| `rarityWhite`, `rarityCyan`, `rarityViolet`, `raritySpecial` | multiplies how many copies of that rune colour are in the rune deck, so how often they are drawn. `1` = as designed (white 3 copies, cyan 2, violet 2, special 1), `2` = twice as common, `0.5` = half, `0` = none | `1` each |
| `timeoutAction` | when a human's turn timer runs out: `stand` = the game stands for them. `lose` = they forfeit the round: no more turns, ranked last, lose the bet | `stand` |
| `onDisconnect` | `eliminate`: a player who drops is out. `bot`: a computer plays their seat until they return | `eliminate` |
| `disconnectGraceSecs` | seconds a dropped player has to reconnect first (0 = immediately) | 20 |

**How `lossFrac` ranks the table:** everyone is ranked by distance from the current target and a bust ranks worse than any non-bust (among busts the bigger overshoot is worse). The worst `ceil(lossFrac x players)` lose lives equal to the current bet. If everyone ties, nobody loses. `lossFrac 0` means nobody loses, `0.5` half the table, `1` everyone except the closest (with `lossTies: 'lose'`, a tie for the closest spot loses too). Rows in the round result carry `winner` (closest) and `safe` (did not lose the bet).

**Disconnects:** `Game.eliminate(id, reason)` takes a player out immediately: their unit cards go to the discard, their runes to the rune discard, and active runes they played stay on the table. Their turn, a pending Double Draw pick, an Exile vote or the next-round ready check move on without them, and the last player alive wins. The server calls it after the grace period (or at once when someone leaves on purpose). A player who reconnects after being eliminated watches the rest of the game.

**Round twists** (`js/engine/twists.js`, config `twistPreset`): a random rule change for a single round, rolled *between* rounds. The next twist is rolled when a round ends but kept secret; when the round starts it gets a full-screen announcement (the title card lingers longer), a log line, and a chip in the top bar for as long as it applies. Never the same twist twice in a row.

| Twist | Effect |
| --- | --- |
| Shifted Target | win condition becomes 17, 24 or 27 (a New Target rune still overrides it) |
| High Stakes | the bet is doubled (after rune modifiers) |
| Tight Grip | rune hand limit 3 and only 1 rune per turn |
| Rune Rain | everyone draws 2 extra runes at the start of the round |
| Speed Round | the turn timer shrinks to a third (min 5 s); only offered when a turn timer is on |
| Rare Tide | rune draws favour rarer runes (best of 3 random cards from the rune deck) |

Difficulty presets (start screen and online lobby): **Off**; **Mild** (about 1 round in 4, from round 2: Shifted Target, Rune Rain, Rare Tide); **Wild** (about every other round, from round 2, all twists); **Chaos** (about 85% of rounds, from round 1, all twists). The start screen and online rooms default to Mild; the engine default is Off. For finer control set `twistChance`, `twistFirstRound` and `twists: { id: true|false }` in the config. To add a twist, add one entry to `TWISTS` (and read its field where it applies).

The first player rotates through the seating order every round (skipping eliminated players). The timer lives in `LocalSession` (so single player and server rooms share it) and the deadline is in `state.turnEnds`; views carry `timer: { total, left }` in ms.

**Unit card numbers:** every face-up unit card shows its number on a badge; hover it to enlarge (click a card to read it big).

**Card set:** the game contains exactly the 37 rune cards (plus unit cards 1 to 11 and both backs) from the supplied card art, nothing else. Ward, Lock In and Last Call are gone; **Vow** is new and **Wrap** is Last Call under its new name. Each rune's rules text in `js/engine/runes.js` is the text printed on the card.

**Vow:** the caster stands automatically for their next 3 turns (casting does not end the current turn) and rune cards can't target them. Auto-stands count toward "everyone stood"; Rebuke / Retaliation / Mischief end it early.

## Tests

```
node tests/engine.test.mjs   # rule / rune / twist / event / scaling / scoring / elimination tests
node tests/sim.mjs           # 300 AI-only games, checks nothing crashes or gets stuck
node tests/net.test.mjs      # server end-to-end: lobby, hidden cards, validation, reconnect, full game
```

## Look, feel and sound

**Screen layout:** a grid of separate zones that never share a box: top bar, two compact plaques (TARGET hero, BET), **opponents** (one scrolling strip), the **table** (latest action, both decks, runes in play), then you (status + lives, your cards, total meter + deck tracker, the Draw/Stand control). The table row takes whatever height is left and the bottom panel never slides over it; on a landscape phone the layout switches to opponents + table on the left and you on the right.

**Opponents:** every opponent is in one horizontal strip, however many there are. Swipe, drag with the mouse, use the mouse wheel, press Left / Right, or click a dot to jump to someone. The strip follows the action (it glides to whoever's turn it is when they're off screen, unless you scrolled in the last 4 s; switch this off in the menu), fades at the edges that still have more, and shows a "‹ Name" pill when the active player is out of view. Rune casts scroll their caster and target into view first. Seats are patched one by one, so a swipe is never interrupted by the game updating. **Players** (or Tab) opens a full list with everyone's lives, cards, runes and status.

**Quality of life:** your total only counts cards that have landed, so it builds up card by card on a new round or Reset and rolls to its new value (landing exactly on target flares); the feed line opens the match log; the wheel scrolls your hand / runes sideways; hovered cards tilt and catch the light; the background shifts colour (calm / your turn / bust). No odds are shown, on purpose. Shortcuts: `?` list, `L` log, `M` sound, `T` twist, `Tab` players.

**Drama and secrets:** the round's twist is a secret until the round starts, then it slams onto the screen (the results screen no longer previews it). Swapped cards (Barter, Trade, Pickpocket) always fly face-down, so only the rune that was cast is ever seen. A player on their last life is called out at the start of a round, and your screen edge beats when it's yours. In the rune drawer, Down closes the preview first and the drawer on the next press.

**Draw and Stand are two separate buttons:** one click or tap does it, with no holding or double-tapping. Keyboard: **D** draws, **S** stands. Draw shows how many unit cards are left in the deck; Stand shows the total you would keep.

**Rune drawer:** click / tap the "Runes" handle (or press Up) to open it, click the handle again, press Down, Esc or click away to collapse it. Left / Right choose a rune, Space plays it (inside menus the arrows follow the layout: Down goes down, Right goes right), clicking a card reads it. It is hidden from assistive tech while closed.

**Cards in motion** (`js/ui/flight.js` + `game-ui.js`): every action has a visible start and end, nothing teleports.
- *Playing a rune:* the card pops up at the caster's own seat (or leaves your open drawer / rune handle) and rests there for a beat with a label and ring, flies to the middle of the screen to be read out, then flies on to its slot on the table (instants dissolve into the table).
- *Drawing a unit card:* it leaves the table deck and lands in the player's seat. Face-up cards flip on arrival; your own cards stop in the middle of the screen so you can read them before they settle into your hand.
- *Drawing a rune:* your new runes come out of the table's rune deck and are revealed with a show that scales with rarity: Common is a quick flip, Rare adds a coloured glow, ring and sparks, Epic adds a darkened stage with rays, a pulsing glow and flashes, Special adds a full-screen flash, screen shake, embers and a long hold. Opponents' rune draws show a small card flying from the rune deck to their seat.
- Reveals share one queue (opponents wait while it plays; Space / tap skips), and reduced-motion users get the same information with no flying or particles.

**Moments:** every rune play takes over the screen for about 4 seconds (5 for special runes) with the card, who cast it, and its effect, plus a countdown bar. Press Space / Enter or tap to skip; this also skips the round title and verdict. Opponents wait while a moment plays (`session.setPaused`, optional so a network session can ignore it). **Full screen** button in the top bar and on the start screen (`js/ui/fullscreen.js`; hidden where unsupported, e.g. iPhone Safari). Round results play a verdict (Safe / Bust / minus lives) with confetti or embers, then a results table. Bet and target changes pop with a ring and a floating number.

**Special runes on the big screen** (`js/ui/cinema.js`): the six Special runes get a cinematic stage when drawn (rise, charge, turn over, name, fly into your hand) and when cast (rise, name + caster + target, whoosh to the target, flavoured impact). It is only a picture: the pointer passes through, keys keep working, a click skips the pause, a stuck stage removes itself after 14 s, and reduced-motion falls back to the plain flights.

**Sound:** all synthesized in the browser (no audio files). Draw, stand, deal, your-turn chime, bet up / down, bust warning, round start, win, lose, eliminated, victory, defeat, and a distinct sound style per rune family (bet up, bet down, target change, dark, shatter, swap, card flurry, blessing, duel, exile, jackpot). Toggle sound and ambient music from the start screen, the speaker button, or the menu. Browsers only allow audio after a tap, so it starts when you press Begin.

**Code map for this:** `js/ui/audio.js` (sounds), `js/ui/fx.js` (particles and floating text), `js/ui/game-ui.js` (layout and event reactions). The engine tags draw / stand / rune / round events on the log so the screen reacts to what happened. A new rune gets a default sound and cast moment automatically; to give it its own sound, add its id to `STYLE` in `audio.js`.

Reduced-motion users (OS setting) get fewer particles and no shaking.

## Where the card art goes

- Images: `assets/cards/` (WebP, 600x840, converted from your 750x1050 PNGs).
- Mapping: `js/ui/assets.js`. One line per card, so you can rename or repoint files.
- To replace a card: overwrite the file with the same name, or edit its line in `assets.js`.
- If an image is missing, a placeholder card is drawn automatically, so the game never breaks.

## Add a new rune

1. Add a `def('my_rune', { ... })` block in `js/engine/runes.js` (each field is documented at the top of that file).
2. Add the image to `assets/cards/` and one line in `RUNE_ART` in `js/ui/assets.js`.

Nothing else changes: the rune deck, the AI, the target/bet math, and the UI pick it up automatically. `copies` controls how often it appears in the deck.

## How multiplayer is structured

```
js/engine/game.js      Authoritative game state + rules. No DOM, no timers.
                       dispatch(playerId, action) in, getView(playerId) out.
js/engine/rules.js     Pure functions: current target, current bet, round scoring.
js/engine/runes.js     Data-driven rune registry.
js/engine/ai.js        Computer players (only use legal actions via dispatch).
js/engine/session.js   LocalSession: the ONLY thing the UI talks to.
js/ui/*                Renders a "view" and sends actions. Never touches Game.
```

To go online: run `Game` on a server (it's plain JS and its state is JSON-serialisable, including the RNG), and write a `NetworkSession` with the same four methods as `LocalSession` (`getView`, `send`, `subscribe`, `destroy`) that talks over WebSocket. `getView` already hides other players' face-down cards and rune hands, so it is safe to send to clients. The engine already supports 2 to 10 players, a per-player "ready" for the next round, and voting (Exile), which is the one rune that needs input from everyone.

## Test mode

Tick "Test mode" on the start screen. The menu then lets you add any rune to your hand so you can try every card.

## Rules I had to decide (please correct any that are wrong)

**Round and turns**
1. Each round every player gets one face-down and one face-up unit card. The first turn rotates each round.
2. On your turn: play any runes (max 3), then Draw or Stand. Drawing or playing a rune resets the "everyone stood" count. The round ends when every living player stands consecutively.
3. The unit deck is a fresh set of 1 to 11 each round: one set in a 1v1 and more sets as the table grows (one per `playersPerDeck` players, rounded up; configurable). Returned or removed cards are reshuffled in if the deck runs out.

**Scoring**
4. Closest to the target **without going over** is safe. If everyone busts, the smallest overshoot is safe. Ties are all safe.
5. Everyone else loses lives equal to the current bet (unless `lossFrac` changes who loses; see above).
6. Starting lives: 10. Bet starts at 1 and rises by 1 each round. Runes can't push it below 1.
7. Last player alive wins.

**Runes**
8. Rune hand: 2 at the start of round 1, +1 each later round, max 6.
9. Rune counts per deck (from "tier"): 3 of each white, 2 of each cyan and violet, 1 of each special, multiplied by `runeDeckMultiplier` (x2 at 8-10 players by default). This is a guess, so adjust `copies` in `runes.js`.
10. **Active** runes stay on the table until round end and are the "latest wins" for targets. Destroying one undoes its effect.
11. **Stall:** no one can draw unit cards for the rest of the turn it is played and the next 2 turns (then it is spent).
12. **Restrain:** blocks drawing and playing runes, except Destroy-type (Rebuke, Retaliation). Mischief now returns an active rune to your hand, so it is not Destroy-type.
13. **Duel:** both players peek the top two deck cards (they stay on the deck). The lower one discards a random rune and skips their next draw.
14. **Exile:** all living players vote; ties are broken randomly; the caster can't be chosen but does vote.
15. **Helping Hand:** if the protected player busts and would lose lives, the helper takes half of that penalty (rounded up) on top of their own and the protected player takes the rest.
16. **Bless:** nobody drops below 1 life this round (losses above that still happen).
16a. **Curse:** the chosen player loses 1 additional life this round, whether or not they were safe (that is how the card reads). **Underdog:** every player tied for the fewest lives draws 2 runes (nothing if everyone is equal). **Unity:** you draw 2, everyone else 1.
17. **Barter / Remove:** "latest card" is the most recently drawn card, including face-down ones.
18. **Trade:** you pick your rune; you get a random rune from the target.
19. **Wager win:** the 2 runes are drawn right after scoring.
20. **Reset:** you must be able to draw 2 cards from the deck to play it.
21. **Double Draw:** the card you reject goes back into the deck at a random spot.
22. Computer players read the full game state (so they can reason about the deck) but only take legal actions.


## UI and animation notes

- **Motion tokens:** one set of easings and durations in `js/ui/motion.js` (JS) and `--ease-*` / `--t-*` in `css/style.css`. Change them once and every flight, banner and panel follows.
- **Non-blocking:** rune casts are a small banner over the table plus a card flying to what it hits. Round start is a banner. Nothing captures pointer or keys. Round end is a short show (flips, rank-by-rank verdicts, lives drain, verdict slam) that any key or click skips straight to the results. The Players panel is docked (no scrim) and the twist is a popover.
- **Client-driven:** Draw and rune plays start moving immediately (ghost cards, `flights.ghost`); the server's view hands them their real destination, and a rejection (`solace:reject`) slides them back. When a view contains a cast, the board commits it when the cast lands (`commitUpTo` in `game-ui.js`), so nothing disappears before the rune that removes it arrives. Swaps, returns and removals are animated from the difference between the old and new view (`diffFlights`), so visuals always match the authoritative state.
- **Keys:** D = draw, S = stand. Up opens the rune drawer, Up again previews the selected card, Down closes the drawer, Left / Right select, Space plays. Tab = players, T = round twist, Esc closes the topmost thing.
- Server: `SOLACE_RUNE_PAUSE` (default 1600 ms) is how long computers wait after a cast.

**Controls:** Left arrow (or D) = Draw, Right arrow (or S) = Stand. A player who is over the target cannot draw normally (rune cards that draw still work). A strip of chips above your status bar names every rune in force on the table and anything affecting you (restrained, vow, skipped draw, over the target, forfeited); tap a chip to read what it does (tap again, click away or press Esc to close it). While the rune drawer is open, Left / Right browse your runes instead of drawing / standing (D and S still work).
