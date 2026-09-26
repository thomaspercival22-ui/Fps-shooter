# Operation TIPS Mania

*TIPS ultimate FPS shooter game*

A tactical first-person shooter built for phones. You play in landscape with touch controls, and after the first load it runs completely offline. There are three missions (pick one under **Mission** in the menu):

- **Compound Defence:** hold a desert compound against waves of squad-based enemies that take cover, flank you, suppress you and throw grenades.
- **Tower Hostage Rescue:** a close-quarters assault on floor 47 of an office tower. There are no waves: 16 hostiles are at their posts, 4 hostages are held at gunpoint, and civilians hide among the desks.
- **Overwatch:** a sniper mission from a ridge about 580 m from the compound. You make precision shots with wind, bullet drop, a rangefinder, a variable-power scope and a spotter who calls your shots.

![Gameplay](docs/screenshot.jpg)

## Play it on your phone

The game is a static web app that installs itself as a Progressive Web App. It needs no app store and no server-side code.

1. **Host it with GitHub Pages (one time, free).** On GitHub open this repo, then go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, pick the branch with the game (`main` once merged, or `claude/mobile-offline-fps-game-we0og0`) and the **/ (root)** folder, then **Save**. About a minute later the game is live at
   `https://thomaspercival22-ui.github.io/Fps-shooter/`
2. **Open that link on your phone** while you're online. The first load downloads about 50 MB and caches everything.
3. **Install it** (this gives you a home-screen shortcut you can tap to play any time). The menu's **Add to Home Screen** button does this for you on Android, or shows the steps:
   - **Android (Chrome):** menu ⋮ → **Install app** (or **Add to Home screen**).
   - **iPhone (Safari):** Share → **Add to Home Screen**.
4. Launch it from the home-screen icon. It opens fullscreen in landscape and works in airplane mode.

> Tip: set **Graphics → Auto** (the default) and the game adjusts its render resolution to keep the frame rate smooth on your phone.

### As a real Android app (APK)

Every push to GitHub builds a native Android app with [Capacitor](https://capacitorjs.com) (`.github/workflows/android.yml`). It opens full screen in landscape, keeps the screen on and plays offline.

1. On your phone, open the repo on GitHub → **Releases** → **Operation TIPS Mania (Android, latest build)**, and tap **OperationTIPSMania.apk**. (Also under **Actions → Android APK → the latest run → Artifacts**.)
2. Open the downloaded file. Android asks once to allow installs from your browser or file manager; allow it, then tap **Install**.
3. To build it yourself: `npm ci`, then `node tools/make-www.mjs && npx cap add android && npx cap sync android` and open `android/` in Android Studio (or run `./gradlew assembleDebug` in it).

This is a debug-signed build for your own phones. Publishing on the Play Store needs a Google Play developer account and a signed release bundle (`./gradlew bundleRelease` with your own keystore).

## What's in it

- **Tower Hostage Rescue (Mission → Tower Hostage Rescue):**
  - **The floor:** you breach from stairwell A into a full office floor, 48 × 36 m. It has a concrete core with lifts, restrooms and an IT closet, a glass curtain wall with the city 183 m below, glass-fronted private offices, a boardroom, the CEO's office, open-plan desks, a kitchen, a server room, reception with the company wall, a lounge and meeting rooms. Walls are plasterboard (rounds go through), the core is concrete, and the glass partitions let you see (and be seen) through rooms.
  - **Hostiles** stand guard or walk patrol routes. They only react to what they see and hear, and gunshots carry less through walls. There are no waves and no reinforcements.
  - **Hostages** kneel, some hooded, with a hostage taker next to them. A hostage taker executes a hostage almost immediately if you **miss** (a round cracking past or landing near him or his hostages), if you **wound him without dropping him**, or if you **get too close** where he can see you. If he only hears the assault elsewhere on the floor he waits 30–45 s (less on harder difficulties) before he does it anyway. A flashbang stuns him and buys time. Walk up to a hostage once the room is clear to cut them loose; they get up and walk out through stairwell B.
  - **Civilians** put their hands up when you burst in, cower under desks, or run from gunfire. Hitting one costs points, and killing one or a hostage is a rules-of-engagement violation.
  - **Debrief** with time, hostages rescued, hostiles down, civilians harmed, accuracy and a grade from S to F.
  - **At night** the power is out: only the green exit signs, emergency lights, server LEDs and the city glow through the windows. Use NVG or thermal.
- **Overwatch sniper mission (Mission → Overwatch):**
  - **The hide:** a sandbagged position on a ridge on the sun side of the compound (the light is behind you), about 580 m from its centre. Crouched behind the parapet, the rifle rests on its bipod and barely moves; standing, the scope wanders. The ammo box in the hide holds rifle rounds only: no grenades, and one FPV drone.
  - **The target:** the HVT is a grey-haired man in a grey suit who walks between the HQ and the warehouse with two bodyguards. If rounds land near him he runs for the west gate, and if he gets out, the mission fails.
  - **Real long-range shooting:** bullets drop about 2 m over 600 m and take about 0.7 s to get there. Wind pushes them sideways and gusts change it. The 8/14/24x scope has a first-focal-plane mil-dot reticle (the dots are 1 mil apart at every power). The elevation turret (ZERO ▲▼) sets the range the scope is zeroed for. The laser rangefinder (LASE) reads the distance, and the scope shows magnification, zero, range and wind.
  - **The spotter** kneels beside you on his spotting scope. He gives you range, dial and wind hold when you lase ("594 metres. Dial 600, hold 0.7 mil left."), calls every shot ("Miss, 40 cm high, 1.1 m left. Splash 0.6 mil high, 1.8 mil left. Hold the dot on him." / "Hit. Target down."), and updates the wind.
  - **Splash dot:** after each call, the spotter marks the round's splash on your reticle. The dot shows where the round went relative to where your crosshair was when the shot broke: orange for a miss, green for a hit, red for a civilian. It includes the reading in mils. Put the dot on the target and fire to correct for the wind and range you just saw. The dot dims when you fire again and clears after 25 s. It disappears for good if the marksman kills your spotter.
  - **Counter-sniper:** there is a marksman on the HQ roof. Once you start shooting, every muzzle blast helps him find the hide. When he has it, his scope glints. If you take too long, his first round cracks past, his second kills your spotter, and then he walks his rounds onto you. Kill him first. Other hostiles run for cover or into buildings when rounds land near them. Civilian workers are around the compound, so make sure of your target.
- **Real gunshots:** every gun plays real recordings of real firearms (public domain, from freesound.org), not synthesised sound.
  - **Your guns:** the suppressed M4 is a suppressed shot's pop layered with the supersonic crack of a 5.56 round and the AR's bolt carrier cycling. The G17 is a Glock 19X and a 9 mm. The M1014 is a shotgun, pitched down towards 12-gauge. The MK13 is a 6.5×55 bolt rifle fired in a forest, with its long natural roll but not its echo.
  - **Enemies:** AK-47 recordings for the riflemen and AR15 recordings for the marksman and heavy.
  - **The place changes the sound:** on floor 47 the rifles and pistols are recordings made indoors, so the room is part of the shot. Beyond 70 m you hear an AR15 recorded from 50 yards away, with the high end gone and the report rolling off the terrain.
  - **Reverb only adds a touch:** the recordings carry their own space, and the reverb has no separate echoes.
  - **Bullet impacts by material:** metal (a car body, steel plate, a thin-metal ping), wood, dirt and sand, glass that breaks, flesh, office carpet and concrete, each with several variations. Ricochets and gun handling (magazine out and in, bolt release, pistol slide, dry fire) are recorded too. Grenades and flashbangs are real explosions recorded in an open field.
  - **Offline fallback:** if the recordings haven't been downloaded yet, a synthesised set takes their place.
- **Muzzle flashes:** unsuppressed guns now show a real fireball: a white-hot core with ragged, turbulent lobes, a flame plume with the intermediate flash, and a glow that lights up walls at night. The M1014 throws burning powder sparks, and the MK13's brake blasts two jets to the sides. Every unsuppressed shot leaves a puff of smoke.
- **High-end graphics (Graphics → Ultra, the default on computers; phones start on High):**
  - **Photo-scanned world:** 4K ground scans with parallax occlusion mapping (pebbles and ruts have real depth), blended with rocky patches. Full-detail scans of concrete barriers, ammo crates, a tarped car, generator, fuel cans, gas bottles, cement bags, desert shrubs, quiver trees, boulders and pebbles. HESCO walls with bulging geotextile and welded mesh. Real corrugated containers with rust runs. Buildings with window frames, grilles, sills, rooftop water tanks, drainpipes and power cables.
  - **Lighting:** soft sun shadows that stay sharp where objects touch the ground (PCSS) and get softer further away. Screen-space ambient occlusion. Screen-space ray-traced contact shadows and reflections. Sunlight bouncing off the sand into shaded areas.
  - **Atmosphere:** desert haze that glows towards the sun, light shafts, and heat shimmer over the distant ground. Filmic AgX colour.
  - **Weapon and hands:** every gun is built from sculpted parts at real dimensions (see *Modern weapons* below). The weapon and your hands cast shadows on each other. Your gloves are sculpted hands with real finger joints that close around the grip, so the right index finger sits on the trigger and the left hand clamps the handguard with its thumb over the rail. They have a synthetic-leather palm, moulded knuckle armour and a hook-and-loop cuff. The sleeves are MultiCam-style fabric with folds.
  - **Enemies:** sculpted bodies instead of boxes, with gloved fists, camouflage fabric with a ripstop weave, helmets with rails, headsets and counterweights, balaclavas and glasses, plate carriers with MOLLE webbing and magazine pouches, battle belts, knee pads and boots.
  - **Light on triangles:** everything is realistic but kept lean. The sculpted guns are simplified to within a fraction of a millimetre (M4 about 115k triangles, MK13 80k, M1014 72k, G17 35k, gloves 9k each). Soldiers and civilians swap to light meshes (about a quarter of the triangles) beyond about 12 m, or beyond 12 m of *apparent* distance through a scope, so targets you are zoomed in on keep their detail. Enemy guns switch to a 2.6–5k-triangle copy far away. The photo-scanned props are decimated to 1–5k triangles each, which halves the compound's scene (from 3.5 M to 1.8 M triangles).
  - **Phones:** phones use a separate memory budget: smaller textures, a lower render resolution and a smaller sky map. On the default High setting the game uses about 0.7 GB, where the old Ultra setting used about 3.4 GB. Ultra is still available on phones, but it needs a lot of memory. If a launch dies while loading (the browser killed the page for using too much memory), the next launch automatically drops one graphics level and tells you on the menu. Medium uses about 0.4 GB.
- **Rain (Mission → Rain):** a storm with an overcast sky, lightning and thunder that arrives after the flash. Rain streaks and splashes stop under roofs. Everything gets darker and glossier when wet, puddles form in low ground with raindrop ripples, and puddles mirror the scene through ray-traced reflections. Rain gets muffled when you go indoors.
- **Realistic impacts:** metal rings, wood knocks and splinters, concrete cracks and throws chips, plaster crumbles, sand thumps, glass tinkles, rubber thuds, and rounds splash into puddles. Rounds that hit metal or concrete at a glancing angle ricochet off with a tumbling whine and sparks, and a ricochet can still zip past you.
- **Digital night vision scope for the M4:** choose Optic → Digital NV scope in the loadout. It is a 3.5x day/night riflescope with a colour display in daylight and a high-gain monochrome sensor at night. It has an electronic reticle and on-screen data, and an IR illuminator on the side.

- **Realistic rendering:** 2K photo-scanned ground and wall textures, baked ambient occlusion (soft contact shading where walls, crates and sandbags meet the ground, darker interiors), eye adaptation when you step indoors, and sun glare with lens flare. An HDR post-processing pipeline gives filmic tone mapping, bloom around muzzle flashes, lamps and explosions, a lens vignette, film grain and subtle lens fringing. The desert has wind-swaying dry grass. Enemy soldiers carry the same detailed rifles you do and have fabric-weave and MOLLE surface detail.
- **Night missions:** choose **Mission → Night** in the menu. You get a moonlit sky full of stars, sodium security lamps, and darkness that makes enemies much slower to spot you. They wear night vision goggles too.
- **Night vision (NVG button / N key):** dual-tube PVS-31 style goggles with phosphor grain, auto-gain and bloom halos. Infrared aiming lasers, yours and the enemies', are only visible through them.
- **Thermal (THRM button / T key):** a white-hot sensor image. Tap again for black-hot, then ironbow, then off. Soldiers glow, gun barrels heat up as they fire, and dead bodies slowly cool. Every shot shows as a bright bloom of hot gas at the muzzle, even through a suppressor, and enemy muzzle flashes stand out on both thermal and night vision.
- **FPV kamikaze drone (FPV button / V key):** you fly a 7-inch quad with a shaped-charge warhead through its analog video link. It has barrel distortion and static that gets worse with range and walls, and an on-screen display with battery voltage, signal strength (RSSI), altitude, speed and home distance. It arms after launch, then detonates on impact, near an enemy, or when you press fire. Enemies hear it buzzing, try to shoot it down, and scatter when it dives at them. You carry two, and the HQ ammo crate restocks them. You kneel while flying, and the drone camera can see your own body.

- **Modern weapons, sculpted part by part:** each gun is modelled from real dimensions out of machined, extruded and turned parts, the way the real thing is made. Every edge has a small radius, so it catches the light.
  - **M4A1:** flat-top upper with Picatinny slots, forward assist, brass deflector, ejection port with a sprung dust cover and a nickel-boron bolt carrier inside. Billet lower with an integral trigger guard, bolt catch, fenced mag release, selector with SAFE/FIRE marks and pins. 13" M-LOK handguard with through-slots. QD suppressor with a knurled collar. SOPMOD-style stock, curved PMAG, EXPS3 sight, PEQ, weapon light, flip-up sights and a sling.
  - **Glock 17 (Gen 5 style):** slide with front and rear serrations, extractor, barrel hood and crown, and white-dot sights with a tritium front. Frame with an accessory rail, textured grip panels, slide stop and takedown lever.
  - **M1014:** receiver with side flutes, ghost-ring sights with protective ears, and a bolt in the port. Twin gas pistons under the forend, barrel clamp and mag-tube cap. Telescoping stock, and a side saddle of 12-gauge shells.
  - **Bolt-action sniper:** fluted heavy barrel and ported brake. OD chassis with an M-LOK forend, folding skeleton stock and adjustable cheek riser. Folded bipod, and a 5-25x56 scope with knurled turrets in rings.
  - **Finishes:** a weapon shader gives each finish its own look: anodised aluminium, nitrided steel, polymer, Cerakote, rubber, nickel boron and brass. Edges worn bright where hands and gear rub, and desert dust in the grooves, are baked from the shapes themselves. Grips get stippling and the turret caps get knurling.
  - **Handling:** every gun has ADS, recoil you have to control, sway, bob, a sprint pose, tactical and empty reloads, ejected brass casings and dropped magazines. Enemies carry low-detail copies of the same guns.
- **Guns that work like the real thing:**
  - **Magazines:** you carry individual magazines, not a pool of rounds. A tactical reload keeps the partly used mag in your pouch; an empty reload drops it. The pips next to the ammo count show full (▮) and partial (▯) mags, and there's a round in the chamber on a tactical reload (30+1).
  - **Fire selector (SEMI/AUTO button / B key):** switch the M4 between semi and full auto.
  - **Suppressor:** the M4 carries a suppressor, so it is quieter and enemies hear it from less than half as far away. There is almost no visible flash: you get a faint glow at the cap, and a bigger first-round pop after a pause. The can soaks up heat. After long strings of fire it shows white-hot on thermal, and after a couple of full magazines it glows dull red to the naked eye (brightest at night, faint in daylight). It takes a couple of minutes to cool.
  - **Malfunctions:** guns occasionally jam, more often when they're hot. Tap reload to run the clear drill: tap the mag, rack the charging handle, and the stuck round flies out.
  - **Barrel heat:** long strings of fire heat the barrel, which opens up your groups, makes the muzzle smoke and glows on thermal.
  - **Moving parts:** the dust cover pops open on the first shot, the bolt carrier cycles with every round and locks back on an empty mag.
- **Grenades:**
  - **Frag:** it bounces, rolls and has a fuse. The damage respects cover, and it sets off red fuel barrels.
  - **Flashbang:** it blinds every enemy looking toward it for several seconds. Blinded enemies stagger, cover their eyes and spray blindly. It will also white-out *your* screen (with a burned-in afterimage) and ring your ears if you look at it.
- **Smart enemy squads:**
  - **Senses:** they have vision cones and a detection meter. They are slower to spot you when you're crouched and quicker when you're moving or firing. They hear your gunshots, sprinting footsteps and even your reloads.
  - **Cover:** they pick real cover by testing it against your position, then alternate between hiding and peeking to fire bursts. They lead moving targets and suppress your last known position.
  - **Tactics:** a squad director sends flankers around by routes you're not looking at. When you reload, get flashed or run low on health, they rush you. They flush out campers with frags or flashbangs, dodge your grenades and fall back when wounded. They coordinate silently, so you never hear or read their chatter.
  - **Enemy types:** Riflemen, shotgun Assaulters who close distance, Marksmen with scope glint, and armoured LMG Heavies.
- **Realism details:**
  - **Ballistics:** bullets travel and drop, damage falls off with range, and headshots are deadly. Rounds punch through wood crates, sheet metal and containers, but concrete stops them.
  - **Visuals:** CC0 photo-scanned PBR textures and scanned props (a tarp-covered car, a generator, jerry cans, propane tanks, wall AC units, utility boxes, trash bags, security lights), a real HDR sky for lighting, sun shadows, impact dust, sparks and bullet holes. Enemy soldiers carry magazines in their pouches and wear helmet chinstraps and counterweights.
  - **Sound:** every sound is synthesized, with sound-travel delay, wall occlusion, bullet cracks and whizzes, and a tinnitus effect.
- **HUD:** a minimap that shows enemies who just fired, directional damage indicators, grenade warnings, a kill feed and scoring.
- **Difficulty levels:** Recruit, Regular, Veteran and Realism.

## Controls

**Touch**

| Action | How |
| --- | --- |
| Move | Put your thumb anywhere on the left side (floating joystick). Push past the rim to sprint. |
| Look | Drag anywhere on the right side. |
| Fire | The big red button. Keep holding it and slide your thumb to aim while firing. There's a second fire button on the left. |
| Aim (ADS / scope) | The ◎ button (toggle). |
| Reload, jump, crouch, switch weapon | The matching buttons. You can also tap the ammo counter to switch. |
| Frag / flashbang | The grenade buttons (they throw where you're looking). |
| Sniper tools | With the MK13: the magnification button (8x/14x/24x), LASE (rangefinder + spotter call), and ZERO ▲▼ (elevation turret, 50 m steps). |

In settings you can adjust sensitivity, FOV, aim assist, and gyro aiming (off, while aiming, or always). **On-screen joystick & buttons → Always** also shows the touch controls on tablets and computers that don't report a touch screen.

**Keyboard & mouse:** WASD, Shift sprint, Space jump, C crouch, mouse aim, LMB fire, RMB aim, R reload, Q/1/2 switch, B fire selector, G frag, F flashbang, N night vision, T thermal, V drone, Esc pause. Sniper: mouse wheel or Z magnification, X lase, ] / [ (or PageUp / PageDown) zero up / down.

## Running it locally (development)

```bash
npm install          # only needed for the tools below
npm run serve        # http://localhost:8080
```

Browsers only allow the offline service worker on `https://` or `localhost`. If you open the game from another device on your Wi-Fi, it will play, but it won't install for offline use. Use GitHub Pages for that.

After changing any game file, regenerate the offline cache list so installed copies update:

```bash
npm run build-sw
```

The recorded sounds in `assets/audio/` are built from public-domain freesound.org recordings (downloaded once into `.cache/sounds/`), sliced, pitched and layered as listed in the tool, and encoded to MP3:

```bash
npm run build-sounds   # node tools/build-sounds.mjs
```

The gloves, soldier bodies and sculpted gun parts are modelled with signed distance fields in `src/sdfmodels.js` and prebuilt into `src/meshdata.js`. After editing them run:

```bash
npm run build-meshes   # or: node tools/build-meshes.mjs glove gloveL   (rebuild only some)
```

The guns are modelled in `src/gunparts.js` with the hard-surface toolkit in `src/hardsurface.js`, and prebuilt into `src/gundata.js` (a few minutes, in parallel):

```bash
npm run build-guns     # or: node tools/build-guns.mjs m4 glock   (rebuild only some)
```

The meshes are stored compressed with meshoptimizer's codec (about 2.1 MB for all four guns and their low-detail copies) and decoded when a gun is first built. `node tools/slim-guns.mjs` re-simplifies the packed meshes to the triangle budgets at its top, without sculpting them again, and adds the far-distance `lod2` copies for enemies.

Other tools: `npm run fetch-assets` re-downloads and recompresses the textures and models (follow it with `npm run simplify-models`, which decimates the few scans that are placed dozens of times), `npm run vendor` re-copies three.js into `vendor/`, and `npm run icons` redraws the app icons.

## Project layout

```
index.html, style.css      page, HUD and menus
manifest.webmanifest, sw.js   PWA: install + offline cache
src/
  main.js      boot, menus, settings, mission select, debrief
  game.js      main loop, level switching, waves, scoring, explosions, flashbangs
  missions.js  the Tower hostage rescue and Overwatch sniper missions (objectives, executions, spotter, counter-sniper, grading)
  level.js     the compound map, the sniper ridge and hide, collision boxes, nav grid, cover points
  tower.js     Meridian Tower floor 47, its scenario and the city below
  officetex.js procedural carpet, ceiling tiles, wood, stone, screens, signage
  civilian.js  office workers and hostages: posed rig, reactions, rescue, hit boxes
  terrain.js   parallax desert ground, wall grime, HESCO mesh shaders
  containers.js  corrugated shipping containers + weathering
  weather.js   rain, splashes, wet world, lightning
  post.js      HDR pipeline: SSAO, ray-traced reflections/contact shadows, fog, bloom, tone mapping, vision modes
  physics.js   collision world, ray casts, character movement
  nav.js       A* pathfinding
  player.js    movement, camera, health
  weapons.js   viewmodel animation, firing, reloading, grenade throws
  gunmodels.js assembles the guns (animated parts, lenses, reticles, sling) and the arms
  gunparts.js  the sculpted gun parts (build time only)
  hardsurface.js  machined/turned-part modelling, mesher, edge-wear bake (build time only)
  gundata.js   the prebuilt gun meshes (generated); guns.js decodes them
  gunmaterial.js  weapon shader: finishes, edge wear, dust, stippling, knurling, suppressor glow
  sdf.js       signed-distance modelling + surface-nets mesher
  sdfmodels.js sculpted gloves and soldier bodies (build time only)
  meshdata.js  the prebuilt sculpted meshes (generated)
  meshes.js    decodes meshdata.js
  fabric.js    clothing/gear shader: camo, weave, MOLLE, per-region materials
  ballistics.js  bullets, penetration, hit detection, tracers
  ai.js        enemy perception, decisions, squad director
  soldier.js   soldier model (enemies and your own body) and animation
  effects.js   particles, decals, brass, lights
  grenades.js  grenade physics
  audio.js     sound engine: recorded clips (assets/audio), synthesised fallbacks, reverb, positional audio
  input.js     touch, gyro, keyboard, mouse
  hud.js       HUD, minimap, scope, flash effects
  textures.js  procedural textures
assets/        CC0 textures, props and sky (from Poly Haven)
vendor/three/  three.js (bundled so nothing loads from the internet)
vendor/meshopt/  meshoptimizer decoder for the compressed gun meshes
```

## Credits

- 3D engine: [three.js](https://threejs.org) (MIT license, see `vendor/three/LICENSE`).
- Mesh compression: [meshoptimizer](https://github.com/zeux/meshoptimizer) decoder (MIT license, see `vendor/meshopt/LICENSE`); the simplifier and encoder are used by the build tools.
- Sounds: real recordings released into the public domain (CC0) on [freesound.org](https://freesound.org); the recordists are listed in [assets/audio/CREDITS.md](assets/audio/CREDITS.md).
- Textures, props (barrels, tyres, ammo box, medical box, covered car, generator, jerry cans, propane tanks, AC units, utility boxes, trash bags, security lights, concrete barriers, military crates, cement bags, roller shutters, shrubs, branches, stones, rocks, quiver trees) and the sky: [Poly Haven](https://polyhaven.com), released as CC0 (public domain).
- Weapons, soldiers, civilians, the office tower and the city, sandbags, HESCO barriers, all effects and all audio are generated in code.
