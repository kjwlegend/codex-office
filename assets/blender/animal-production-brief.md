# Cow and horse coworkers — production brief

- Purpose: seated, animated coworkers for the existing local Three.js virtual office.
- Art direction: warm stylized management-game figures; rounded silhouettes, broad readable faces, tailored clothing matching the existing human. Cow: ivory/charcoal coat, rose muzzle, small ivory horns, wide ears. Horse: chestnut coat, dark mane, long muzzle, narrow white blaze and upright ears.
- Scale reference: existing employee source, same chair, 0.98 m desktop and nine-bone rest pose. Floor origin, Blender +Z up/-Y forward exported to glTF +Y up/+Z forward.
- Budget: LOD0 at most 40k triangles, LOD1 under 40%; reuse packed original 2K fabric textures; no network assets. Geometry accent materials and vertex-colour coats keep markings local and editable.
- Animation: existing spine, head, shoulders, elbows and wrists drive typing, screen review and mouse use. No animation clips or collision meshes; these are non-physical display figures.
- Deliverables: two editable blend files, two embedded GLB assets, validation reports, deterministic build script, browser integration and focused regression tests.
- Workflow: inspect original source → author primary heads/ears/muzzles → review silhouette → add markings/mane/horns/tails → skin to existing rig → create real low-detail geometry → validate normals/UVs/manifold geometry/weights/budgets → export → review Blender three-quarter/profile previews → review browser desks, actions and both scene themes.
- Execution: Blender MCP connection was unavailable; the installed Blender 5.2 LTS background executable runs the checked-in Python script in an isolated process.
- Runtime contract: species selection is stable by agent ID, never by performance/status/role. Model-specific failures degrade independently; identity, usage, selection and relationships are retained.
