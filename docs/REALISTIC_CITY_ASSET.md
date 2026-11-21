# Realistic city asset integration

## Target visual direction
A grounded modern US city inspired by Los Santos: mixed downtown skyline, mid-rise commercial blocks, residential streets, parking lots, service alleys, road markings, sidewalks and street furniture. Do not use Rockstar/GTA V ripped assets.

## Current candidate for evaluation
- Model: [Realistic City by Pasha](https://sketchfab.com/3d-models/realistic-city-8dbfd6fc44c046c68853d9c95cc2918c)
- Sketchfab listing reports: 256.7k triangles, textured, game-scene/game-ready description, downloadable.
- License shown on listing: Creative Commons Attribution (CC BY). Preserve creator credit and the exact license URL from the downloaded asset metadata in `ASSET-CATALOG.json`.
- This is a candidate, not yet approved for shipping. Before replacing the live city, inspect the downloaded archive for GLB/glTF availability, texture integrity, world dimensions, origin, road elevation, and actual file size. The listing's dimensions and download size have not yet been independently verified.

## Mobile acceptance targets
- Prefer a city scene under 20–30 MB after optimization; split into streamed districts if larger.
- Aim for roughly 250k–500k visible triangles in the active camera region; use LOD or district loading for larger worlds.
- Avoid one enormous shadow-casting mesh. Keep static geometry chunked and limit shadow casting to nearby chunks.
- Preserve GLTFLoader, current touch controls, player/vehicle physics, NPC AI, minimap, GPS and traffic.
- Keep the existing `assets/models/city.glb` until the candidate passes desktop and Android testing.

## Integration path
1. Download the model using Sketchfab's official Download 3D Model action and retain its license/author metadata.
2. Convert to GLB only if needed, preserving PBR textures and units.
3. Place the verified file at `assets/models/city-realistic.glb` and record its source, author, license, original URL, local filename, triangle count and file size in `ASSET-CATALOG.json`.
4. Test bounding box, road Y, scale, spawn point and collision generation. The world bounds now adapt to the loaded city's X/Z dimensions.
5. Only after Android performance and gameplay checks, switch the loader to the new file. Keep the old city as a rollback asset until the replacement is accepted.

## Current implementation preparation
`src/world/CityBuilder.js` recalculates `CITY.SIZE` and `CITY.HALF` from the loaded scene bounds, then replaces the initial 500 m boundary walls. Traffic and pedestrian placement already read these shared values, so they follow the expanded map bounds.
