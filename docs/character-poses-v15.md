# Character artwork v1.5

The four characters each have 100 refreshed poses with outward cheeks, high widely spaced eyes, and flat skin colour #56515B. Faces have no interior cheek creases or mottled shading. Most eyes are deadpan; analytical poses may use a restrained upper lid. Existing pose IDs, titles and actions are retained.

The packaged archive contains 401 transparent PNGs and 401 editable SVGs: 400 poses and the family master. Pose PNGs have a 1024px long edge. SVGs contain vector shapes and fixed colours, with no embedded raster images, gradients or filters. The palette is RGB; print conversion depends on the printer's ICC profile.

`restore-studio-refreshed-assets.mjs` verifies the archive and every asset SHA-256 before restoring files. Assets are served through existing authenticated routes, with `version=final-v1.5`; `format=svg` selects the vector original. Both formats share the bounded 8 MiB LRU cache. Original v1.4 and unversioned selections continue to resolve to their exact previous artwork. New selections use v1.5 by default.

The prior group scenes and nonverbal graphics retain v1.4. Saved references are never migrated merely by opening the editor.
