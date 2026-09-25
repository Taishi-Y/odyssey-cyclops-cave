# ODYSSEY: The Cave of Polyphemus

A browser 3D game (Three.js) based on the Cyclops cave sequence in Christopher Nolan's The Odyssey.

## Run
    cd ~/Projects/odyssey/game
    npm run dev
Open http://127.0.0.1:5188/ (Chrome recommended). Add `?q=low` if it runs slowly, `?q=high` for the best image.

## Controls
- WASD or Arrow keys walk / Shift run (sprint) / Ctrl or C crouch / Space jump
- Left click: hold to draw the bow, release to shoot (spear: throw)
- Right click: aim
- 1 bow / 2 spear / E interact (log, harden the stake, blind the giant, tie on straw, pick up arrows)
- Jump (Space) and aim the bow in mid-air: slow motion like Breath of the Wild. Drains the green stamina wheel (sprinting drains it too)
- Tab (hold): GTA-style weapon wheel, time slows while it is open (bow / spear / stones)
- Z: prone (Metal Gear style crawl, almost invisible in the dark)
- F: knock on a nearby wall to lure the giant; stones (3) make noise where they land
- X: GTA V-style switch to another crewman (sky-cam transition)
- The crew fight as a squad: their leader (Eurylochus, then whoever is next) roars orders and they regroup, attack all together, flank (bait in front, swords behind), scatter or fall back. G / R: Odysseus orders an all-out attack / scatter himself
- Soliton radar (top right) shows the giant's field of view; getting seen triggers "!" and the ALERT / EVASION / CAUTION phases
- Awareness meter (The Last of Us / Assassin's Creed): fills white, orange, red as the giant notices you; crouch next to a straw pile to hide
- Caught? Mash E / Space (tap on phones) to break free (God of War style). Blinding the giant is a timing strike: press E when the rings meet
- Push into a rock face to climb it (Zelda), eat cheese to heal, pick up arrows and stones
- P: photo mode (free camera, depth of field, filters, save PNG)
- Phones vibrate on footsteps, hits and grabs
- V: switch between third-person (default) and first-person camera
- H or F1 (or the ? button on phones): help screen with all controls, actions and HUD explanations. Pauses the game

## Story
1. Follow the sheep into the cave. The giant returns and seals the entrance with a boulder.
2. Night: he eats your men. If he spots you he grabs you (shoot his eye to stagger him).
3. He sleeps. Harden the olive-wood stake in the fire and drive it into his eye.
4. Tie straw to your back, crouch, and crawl out among the sheep.
5. Outside, he prays to Poseidon. Your surviving men are counted.

Checkpoints: `?phase=night|sleep|blind|gate`

## Assets and licenses
- Rock textures and props: Poly Haven (CC0)
- Human models: generated with MakeHuman / MPFB (CC0 assets)
- Soldier helmet: 3D scan of Corinthian Helmet 1926.54, Cleveland Museum of Art (CC0), fitted and given a horsehair crest in work/helmet_scan.py
- Cyclops loincloth: "Basic Loincloth 1" by Elvaerwyn (CC-BY)
- Sheep: "Realistic Woolly Sheep - Thick Curled Fleece" (https://sketchfab.com/3d-models/realistic-woolly-sheep-thick-curled-fleece-7e3af9a88cb14eb3851c9f4871bb063b) by Pigcraft (https://sketchfab.com/s8819296), CC-BY 4.0. Decimated and re-baked for the game
- Animations: X Bot (Mixamo) clips from the three.js examples, retargeted
- Player / crew locomotion (walk, jog, sprint, crouch, jump): Universal Animation Library by Quaternius (CC0, https://quaternius.itch.io/universal-animation-library), retargeted with hip bob (work/anim/ual_extract.py)
- Cyclops voice: clip from YouTube cTEaP8VxN6o (film audio, personal use only)
- Campfire logs: "Campfire Wood Survival Warm and Light" (https://sketchfab.com/3d-models/campfire-wood-survival-warm-and-light-efd0ac8c5cca46bfaae91b3851b9c75f) by digrafstudio (https://sketchfab.com/digrafstudio), CC-BY 4.0. Converted to metal/rough
- Flames: our own Blender Mantaflow sim baked into a flipbook (work/firesim/sim.py, atlas.py)
- Cave, sheep, fire and other sounds are generated in code
