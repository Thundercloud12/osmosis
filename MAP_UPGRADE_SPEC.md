# OSMOSIS — Warehouse Map Upgrade (Agent Implementation Specification)

**Status:** Ready for implementation
**Scope:** Upgrade the existing 2D top-down Phaser arena and minimap; preserve the working game.
**Authority:** `docs/PRD.md` controls gameplay rules and user experience; `docs/ARCHITECTURE.md` controls stack, server authority, security, and module boundaries. This document controls **map design, asset integration, and associated visual/geometry changes only**. If there is a conflict, preserve the PRD and Architecture and report it.

---

## Agent mission

**IMPLEMENT this upgrade in the existing repository. Do not stop at a design proposal.**

The current map works mechanically, but visually resembles a large flat floor with scattered rectangles/containers. Transform it into a coherent, recognizable **industrial warehouse complex**, with distinct rooms/zones, reusable 2D game art, layered floor detail, meaningful route choices, and a useful minimap. Aim for the **legibility, room identities, and playful approachability of a polished top-down social game**, without copying *Among Us* art, UI, maps, characters, or assets.

**Non-negotiables**

1. Preserve existing movement, collisions, camera, fog/line-of-sight, multiplayer synchronization, battles, linking, pickups, bases, team-only voice, 15-minute match, and all scoring rules.
2. Preserve **server-authoritative geometry and visibility**. No client-only obstacle or hidden-enemy data leakage.
3. Acquire and use **actual appropriately licensed 2D assets**; do not deliver only CSS/SVG rectangles with labels and call the warehouse finished.
4. Prefer a **hand-authored layout assembled programmatically or through a tilemap editor**. No random obstacle scatter as the final result.
5. Stay in Phaser 3 + existing React/TypeScript / Colyseus stack. Do not introduce Three.js, Unity, a new backend, procedural 3D, or other unnecessary dependencies.
6. The deliverable is **working code + committed local art assets + reproducible map source + tests**, not a mockup.

## 0. Inspect the existing repo first

Before editing:

- Read `docs/PRD.md` and `docs/ARCHITECTURE.md` in full; note the real repo paths if they differ.
- Locate the map definition, render/scene initialization, camera/world bounds, existing minimap, collision code, **shared/server** obstacle data, LOS/fog-of-war implementation, player spawn locations, base zones, item placement, and current tests.
- Determine whether the map is currently generated from code, JSON, or Tiled; use the existing approach if practical. Avoid replacing functioning systems just to adopt a new format.
- Record the current player radius, movement speed, vision radius, camera zoom, viewport scale, and arena dimensions. Do not guess scale from the screenshot.
- Take a **before** screenshot from an actual local run if screenshot tooling exists. Use the provided current-game screenshot as a visual baseline when available.
- List the specific files you expect to change. Do not start with broad refactoring.

## 1. Art direction: attractive, readable, coherent

**Theme:** A lively, slightly mysterious warehouse/factory compound with loading docks, storage racks, packing/sorting lines, maintenance rooms, machinery, warning stripes, fencing, cables, and crates.

**Style:** Polished **top-down illustrated/pixel-tile game**, colorful enough to distinguish areas but not fluorescent. Good silhouettes, consistent perspective, intentional contrast, subtle shadows, and floor markings. The current dashboard-like neon aesthetic is **not** the target. Preserve readable player sprites and team colors.

### Verified candidate asset sources

All of the following source pages currently describe their packs as **CC0**; **verify the license again at download time** and record the exact download/version/license in the repo:

| Candidate | URL | Good for | Notes |
|---|---|---|---|
| Kenney — Tiny Factory | https://kenney.nl/assets/tiny-factory | Factory, warehouse and conveyor-style tiles | 16×16 pixel tiles, CC0; good possible primary visual system |
| Syntaxes of Play — Pixel Factory Interior Props | https://synofplay.itch.io/pixel-factory-props-pack-free | Conveyor belts, consoles, shelf racks, machines, workbenches, robotic stations | CC0; includes a sample Tiled map |
| Screaming Brain Studios — Tiny Top Down Pack | https://screamingbrainstudios.itch.io/tiny-top-down-pack | Interior floors, walls and doors | 32×32 pixel tiles, CC0; potentially different pixel density |

**Asset-selection rule:** Review screenshots/previews and choose **one coherent base style**, ideally using only one core pack plus carefully matched additions. **Do not indiscriminately mix 16×16 and 32×32 packs** if their pixel density, perspective, outlines, or palettes clash. You may tint/recolor/rescale assets in a scripted and documented way, but don't let textures become blurry. If the existing character art is visually incompatible, prefer harmonizing scale/contrast instead of redesigning the characters in this task.

- Save downloaded assets **inside the repository**, with stable paths; never hotlink from third-party sites at runtime.
- Store originals separately from generated spritesheets/atlases when licenses and distribution allow.
- Create `assets/third-party/README.md` (or equivalent) containing source URL, author, asset-pack name, download date/version, license, and any transformations. Keep the license text if provided.
- Do not use copyrighted *Among Us* graphics, official Alice in Borderland assets, ripped sprites, or unverified Pinterest/Google Images screenshots.
- If an asset source cannot be downloaded programmatically, **do not claim it was integrated**. Use another verified pack or clearly flag the exact missing asset and implementation limitation.

## 2. Build one coherent level, not a bigger random field

**Map name:** `Warehouse Complex` (working title).
**Team geography:** Blue HQ at the western/left side; Red HQ at the eastern/right side.
**Overall plan:** Make a substantially larger traversable environment than the current prototype, but keep encounters frequent enough for **10 players in a 15-minute round**.

Design the following **recognizable zones**:

1. **Blue HQ + Receiving Bay (west):** safe, immediately recognizable spawn/re-arm region, industrial dock decor.
2. **Red HQ + Dispatch Bay (east):** strategically equivalent to Blue HQ; visually distinct team accents.
3. **Central Sorting Hall:** recognizable central landmark with conveyors, packing tables, control consoles, high encounter probability.
4. **North Loading Docks:** wide sightlines, cargo lifts, parked pallet loads, marked lanes; fast but exposed flank.
5. **South Storage Rack Maze:** narrow aisles, alternating sight blockers and alternate exits; good for coordinated ambushes.
6. **Maintenance / Electrical Room:** generators, overhead wires, cabinets and maintenance machinery; a distinct side route.
7. **Office / Security Control:** desks, glass/wire partitions, windows/doorways, readable room outline; optional connector near central area.
8. **Packing / Conveyor Annex:** crates, belt machinery, repeatable modular prop motifs; another combat/collection hotspot.

**Topology sketch — inspirational, not exact geometry:**

```text
                       [ NORTH LOADING DOCKS ]
                      /          |            \
 [ BLUE HQ ] -- [ RECEIVING ] -- [ CENTRAL SORTING ] -- [ DISPATCH ] -- [ RED HQ ]
                      \        /  |  \         /
                    [ MAINTENANCE ] [ OFFICE ]
                         \       |       /
                       [ SOUTH STORAGE RACKS ]
                           \--[ PACKING ]--/
```

The layout must be one connected traversable level; passages and routes should make real spatial sense rather than becoming isolated boxes with decorative room labels.

### Level-design constraints

- At least **three meaningful macro routes** between bases (north / central / south), with cross-connectors so players can change plans mid-route.
- Provide **loops**; avoid dead ends that trap a player with no tactical options, except small intentional dead-end reward alcoves.
- Each major zone should ideally have **2+ usable entrances/exits**; main central hall should have more.
- Provide **wide corridors** for team movement and **some narrow tactical corridors** for ambushes; do not force all combat through a single choke.
- Incorporate a few **short, readable sightlines** and a few **long, dangerous sightlines**; containers/racks/walls should create fair concealment.
- Ensure the two HQs have comparable travel costs to central routes and item locations. Layout can be aesthetically asymmetric, but **functional route access must be balanced**.
- Keep spawns/re-arm areas safe, readable, and wide enough for **five characters without overlap/collision weirdness**.
- Avoid decorative clutter in the immediate routes out of bases and around pickups/interactions.
- Do not simply make the map gigantic: initial playtest target is a **roughly 35–60 second unobstructed-speed route** between HQ approaches along at least one intended practical path; derive world dimensions from existing player speed, and tune via playtest. This is a design target, not an immutable rule.
- Aim for **frequent, intentional decisions** (which lane, whether to risk center, when to coordinate) without leaving players running through empty floors for a full minute.
- Treat these as map-tuning constraints; if your measured movement speed/camera vision makes them unrealistic, report the actual traversal timing and select a playable size.

## 3. Obstacle and visual-prop taxonomy

Do not treat every rendered object as the same rectangle. Define properties for every **gameplay obstacle**:

| Object | Blocks movement | Blocks line of sight | Notes |
|---|---|---|---|
| Solid walls, tall closed cabinets, tall rack stacks | Yes | Yes | Opaque silhouette and correct collision footprint |
| Large industrial machines / stacked cargo | Yes | Usually yes | Tag exact opaque footprint; visuals may overhang footprint |
| Chain-link fence / wire partition | Yes | **No** | Crucial: players can see through it but cannot cross |
| Glass office wall/window | Yes | **No** | Clear transparent appearance and collider |
| Low pallet, short crates | Yes | Configurable, generally **No** if visually low | Consistent rules across identical prop types |
| Floor paint, route arrows, cables drawn on floor | No | No | Decoration only |
| Ceiling cables / hanging light / safety signage | No | No | Decor-only, not an invisible wall |
| Door opening | No | No | Reachable. Closed doors only if implemented and defined, **no dynamic door mechanic in this task** |
| Base boundary decals | No | No | Keep existing base capture/re-arm geometry authoritative |

**Important:** The visual sprite is not automatically its collision shape. Use deliberate, documented collision footprints. A player must not collide with invisible decorative wiring or walk through visibly solid machinery.

## 4. Map data + engine integration

Implement or adapt the existing map pipeline. **Preferred shape:** editable **Tiled-compatible JSON** or another deterministic, checked-in generated map plus a script that recreates it from source. Phaser supports Tiled tilemaps; retaining the existing programmatic generator is acceptable if cleaner.

Recommended conceptual layers:

```text
WarehouseComplex
├── ground            # main floor surfaces
├── ground_detail     # stripes, painted lanes, scuffs, cable decals
├── lower_props       # pallets, machinery bases, crates, rack footprints
├── walls_and_props   # major structures
├── upper_details     # overhangs, overhead cables, lamps
├── zone_markers      # friendly labels, landmarks (render only when appropriate)
└── gameplay_objects  # team bases, spawn markers, pickup spawn anchors
```

Maintain **separate semantic geometry** (or properties in a shared map definition):

- `movementColliders`: solid footprints/boundaries for player movement.
- `visionOccluders`: opaque segments/polygons for fog of war.
- `teamSpawns` and `baseZones`: precise extents for existing gameplay.
- `itemSpawns` / pickup locations: accessible positions, not in walls or permanently obscured by props.
- `navZones` / simplified `minimapGeometry`: optional derived, not separate hand-maintained gameplay truth.

**Source of truth requirement:** The authoritative server geometry (typically `packages/shared/src/map/`) and the Phaser visual geometry **must derive from the same map dataset**. Avoid maintaining a frontend map and unrelated server rectangles. Adjust code paths carefully so prediction, reconciliation, server collision and visibility continue to agree.

- Preserve the current collision shape semantics if the server simulation only supports rectangles/segments; do not add polygon complexity unless absolutely necessary.
- Convert tile coordinates to world coordinates in **one shared helper**, with tests for scale/origin offsets.
- If the map has a larger world rectangle, update Phaser bounds, camera bounds, spawn positions, item spawn constraints, interaction zones, LOS world clipping, server-side map bounds, and minimap sizing **together**.
- Keep the round deterministic: if using a generator, check in its seed/config or output. Random props may decorate floor-only positions, but **gameplay geometry must not differ across clients or server**.
- Treat *all* players as having the same static map geometry; only player/item visibility is secret as defined by `ARCHITECTURE.md`.

## 5. Fog-of-war and visual clarity

Preserve the existing visibility mechanics and server filtering. The new map should make them **more visually understandable**:

- Opaque walls, solid machinery and tall rack stacks cast real occlusion.
- Transparent fence/glass objects block movement but **not** LOS.
- Outside the player's visible area, dim the environment sufficiently for tension **without turning the entire map into featureless black**. Hidden enemy avatars must not render or leak via network state.
- Floor tiles, lighting, color and labels should help players immediately recognize which area they have reached.
- Avoid making walls or dark containers visually indistinguishable from fog.
- Do not introduce expensive real-time shadows for every small prop; reuse the current performant fog/masking system.

## 6. Minimap: floor plan, not an indiscriminate texture thumbnail

The current radar is too small and visually generic. Upgrade it with **the same map data**:

- Draw simplified area/room outlines, outer boundary, major walls, and route corridors.
- Show Blue and Red bases distinctly; show **self** and **same-team players** by recognizable dots/markers.
- Do **not** reveal unspotted enemies, hidden enemy points, or secret pickups; obey PRD/Architecture visibility rules.
- Fit the **whole map** to the minimap box while preserving aspect ratio; never stretch it nonuniformly.
- Show the player's current viewing area/orientation if this improves readability and remains unobtrusive.
- Use distinct zone tints and minimal labels/icons only at readable scales.
- Keep it compact during play, but allow a larger readable **tactical map overlay** via a key (e.g. `Tab`) if existing UX/input handling permits; don't conflict with existing bindings. This is optional polish, **not required for map completion**.
- Prefer deriving minimap shapes from the semantic map over drawing a second, stale hand-built representation.

## 7. Visual polish targets

Include **real art assets**, not just labels:

- Receiving: dock shutters, ramp/floor lanes, pallets.
- Sorting: conveyors, industrial sorter, package stacks.
- Storage: modular shelving and boxes, aisle codes on the floor.
- Maintenance: generators/electrical cabinet, coiled cable / floor cable decals.
- Office: office wall edges/windows, desks/consoles.
- Packaging: worktables, box piles, material handling equipment.
- Site-wide: occasional forklifts or carts, floor arrows, hazard striping, numbered bays, subtle wear patterns and small light pools/shadows.

Do not overdecorate. Keep **player silhouette, attack contact edges, item glows, base zones and visibility boundary** unambiguous. Match asset footprint to camera/character scale; avoid tiny microscopic props or oversized warehouse machinery.

## 8. Implementation order / checkpoint gates

Complete these in sequence; use existing repo scripts and conventions:

### A — Repo audit and asset selection
- Confirm existing map, shared geometry, fog, server and minimap integration paths.
- Inspect/source asset candidates; pick cohesive final art pack(s).
- Import raw assets and document licenses; write any scripted atlas slicing/palette transforms needed.
- Deliverable: assets visibly load in a local Phaser scene; no broken texture IDs.

### B — Gameplay blockout (before detailed decorations)
- Lay out full warehouse zones and three macro paths using clear temporary tile art or basic blocks.
- Define all traversability/LOS semantics centrally.
- Place HQs/spawns and item anchor locations; update bounds on frontend and server.
- Test camera/collision/LOS/point interactions manually and programmatically.
- **Do not** spend time on shadows and floor decals before the map's pathing works.

### C — Replace blockout with asset-based environment
- Assemble rooms using chosen sprites/tiles; use correct layers and consistent pixel density.
- Add distinct props/markings per room; preserve underlying gameplay geometry.
- Minimize repeated long blank walls; keep visual variation controlled and purposeful.
- Adjust fog readability on the new artwork.

### D — Minimap + validation
- Generate/derive minimap from the same map geometry.
- Test in at least two simultaneously running browser clients and server, including opposite teams and hidden enemies.
- Run automated route and geometry tests; run lint/typecheck/build/test scripts.
- Capture **after** screenshots of (1) central hall, (2) storage maze, (3) HQ, and (4) full minimap, if tooling permits.
- Document tested scenarios, measured traversal times and remaining visual limitations.

## 9. Required automated tests / validation

At minimum, create or update tests for:

1. **Connected geometry:** BFS/flood-fill or equivalent over walkable cells confirms Blue HQ, Red HQ and all required gameplay regions are accessible; no accidental sealed-off room.
2. **Route variety:** Document/test at least three usable macro routes between HQ approaches (distinct north/central/south route corridors). Avoid brittle assertions tied to aesthetic tile indices.
3. **Spawn and item safety:** Player and pickups never spawn inside colliders, inaccessible islands or completely enclosed geometry.
4. **Movement and LOS disagree correctly:** A fence/window blocks movement but allows sight; an opaque rack/wall blocks both; decorative floor cable blocks neither.
5. **Authoritative consistency:** Collision and sight shapes are identical in the shared/server source and Phaser renderer after world/tile conversion.
6. **Minimap privacy:** Same-team location markers are shown; enemy position not shown unless rules explicitly authorize it.
7. **Gameplay regression:** Tag -> both inactive -> re-arm; item collect; raid/bases; teaming link; countdown; camera bounds; reconnection if exercised. Do not modify scoring constants.
8. **Performance:** Render a full-sized level smoothly on a typical laptop; avoid creating physics bodies for harmless decor. Measure if practical, don't invent benchmark numbers.

## 10. Completion checklist (must all pass)

- [ ] Actual third-party game artwork appears on the floor, walls and props; asset sources and licenses recorded.
- [ ] Warehouse visually contains several distinct, recognizable zones; feels like a connected building/compound, **not rectangular obstacles scattered in empty space**.
- [ ] Arena is appreciably larger than current one, but 10-player encounter pacing remains plausible for a 15-minute round.
- [ ] Three viable cross-map routes plus loops and cross-connectors exist.
- [ ] Both bases, spawns, pickups, camera, LOS and collision work in the upgraded world.
- [ ] Transparent barriers block player movement without blocking vision; opaque obstacles block both.
- [ ] Map and authoritative server use **one canonical geometry**, and existing enemy visibility/privacy guarantees are intact.
- [ ] Minimap is a comprehensible, aspect-correct floor plan.
- [ ] Current Phaser, React, Colyseus and gameplay system continue to function; no accidental scoring or multiplayer logic rewrite.
- [ ] Repo builds and existing/regression tests pass; limitations reported transparently.

## 11. Expected deliverables and final agent report

Prefer existing repo conventions over these example locations:

```text
docs/MAP_UPGRADE_SPEC.md          # this task description
apps/web/public/assets/warehouse/ # locally hosted tiles/sprites/atlases
apps/web/src/game/...             # Phaser loading and rendering integration
packages/shared/src/map/...       # canonical warehouse geometry/map data
apps/web/src/ui/...               # minimap rendering changes if React-driven
assets/third-party/README.md      # source and license manifest
...tests...                       # geometry + minimap + LOS regression tests
```

**When finished, report briefly:**

1. Which asset packs you actually used (with local asset paths and licenses).
2. The changed files and map source format; which component is the map source of truth.
3. How new zones, collision/LOS, bases, pickups, camera and minimap work.
4. Tests run and results; actual traversal timing / basic performance observations if measured.
5. Any blockers or incomplete work. **Do not present placeholders as completed asset integration.**

## 12. Hard out-of-scope boundaries

Do **not** redesign the lobby, match HUD, scoring formulas, team link rules, player networking protocol, LiveKit voice, roles, rematches or inventory/persistence. Do not add NPCs, shooting, destructible props, dynamic door mechanics, new powerups, elevators, multi-floor movement, moving conveyors or interactive forklifts. Static conveyors/machinery and decorative cables are fine. This upgrade is **level geometry + art + minimap**, not a gameplay rewrite.

**Final priority order:** **(1) existing mechanics intact → (2) balanced traversable map → (3) verified reusable assets → (4) correct visibility → (5) clear minimap → (6) visual polish**.
