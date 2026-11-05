# Final character library

The approved November 5, 2026 version 1.4 contains 449 transparent PNGs: four characters × 100 individual poses, 36 shared scenes, 12 nonverbal balloons, and one family model. The original ZIP is stored as ordered binary parts under `assets/studio-final-v14`. Build and test setup verify the archive SHA-256, then verify and restore every PNG without changing its bytes or alpha channel.

`shared/studioFinalAssets.json` carries each pose's actual ID, title, description, expression direction, and dimensions. The character archive supports individual previews, expression filters, name/description search, enlargement, and PNG download. Shared scenes and balloons have separate preview groups. The four existing character IDs remain unchanged.

New selections save `assetVersion: "final-v1.4"` alongside the character and pose number. Existing unversioned selections keep their original measured sheet crops. A user can explicitly replace an old reference using the version selector; opening or filtering the picker does not alter a saved cut. The selected version is retained in image downloads, prompt guidance, serialization, and API generation inputs.

All final image routes use the existing operator-session protection. Restored images live outside the public directory. The server returns original PNG bytes, uses only catalog IDs, and limits the PNG cache to 8 MiB. No image-generation or social-publishing call is required to browse or use the archive.

Character guidance now follows the approved model: clear glass helmets, smooth pen and matte paint, one camera for Pengpeng, practical T-style Pempem, a cube for Penggin, and a guitar and unique head tuft for Pengki. Legacy sheet files remain available for existing drafts.
