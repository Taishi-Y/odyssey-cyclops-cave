# ODYSSEY: The Cave of Polyphemus

A browser 3D game (Three.js) based on the Cyclops cave sequence in Christopher Nolan's The Odyssey.

## Run
    cd ~/Projects/odyssey/game
    npm run dev
Open http://127.0.0.1:5188/ (Chrome recommended). Add `?q=low` if it runs slowly, `?q=high` for the best image.

## Controls
- WASD move / Shift run / Ctrl or C crouch / Space jump
- Left click: hold to draw the bow, release to shoot (spear: throw)
- Right click: aim
- 1 bow / 2 spear / E interact (log, harden the stake, blind the giant, tie on straw, pick up arrows)
- Jump (Space) and aim the bow in mid-air: slow motion like Breath of the Wild. Drains the green stamina wheel (sprinting drains it too)
- V: switch between third-person (default) and first-person camera

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
- Cyclops loincloth: "Basic Loincloth 1" by Elvaerwyn (CC-BY)
- Animations: X Bot (Mixamo) clips from the three.js examples, retargeted
- Cave, sheep, fire and sound are generated in code
