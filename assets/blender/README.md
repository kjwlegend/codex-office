# Office employee / 办公室员工

Original, editable Blender assets authored for Codex Office, under the repository's MIT license. No downloaded character, texture, external account, or paid asset service is required.

本目录保存 Codex Office 原创人物的可编辑 Blender 源文件和原创布料贴图，采用项目 MIT 许可证。没有引入第三方人物、付费素材或账户数据。

## Art brief / 美术目标

Warm, stylized management-game characters that remain legible from a multi-project office overview to an individual desk. Adult seated proportions, shaped facial features, fingers, tailored shirt, three hairstyles, optional glasses. Office and cell themes share the same person and skeleton; appearance never changes agent identity or permissions.

目标是温暖的风格化经营游戏人物：既能在多项目全景中辨认，也能拉近查看工位。保留面部、手指、衣领与发型细节；办公室和隔间共享同一人物及骨骼，不改变 Agent 身份或权限。

## Files / 文件

- `office-employee.blend`: editable source, nine-bone rig, high/low geometry, materials, look-dev lights and camera.
- `T_OfficeFabric_BC.png`, `T_OfficeFabric_N.png`: original seamless 2048 × 2048 cloth textures, packed into the blend and GLB.
- `../../scripts/build_office_character.py`: deterministic asset authoring, UVs, weighting, LOD, geometry validation, GLB export and look-dev renders.
- `../../dashboard/assets/office-employee.glb`: shipped runtime asset, embedded into generated HTML; users do **not** need Blender.
- `../../dashboard/assets/office-employee.validation.json`: geometry/UV/budget report from the successful build.

## Rebuild / 重新构建

Validated with Blender 5.2.0 LTS. Run from the repository root:

```bash
blender --background --factory-startup --python-exit-code 1 --python scripts/build_office_character.py
```

The command creates its own factory-startup scene; it does not touch an open Blender document. Generated preview images and initial backup go into ignored `work/`. It replaces the listed authored/exported assets; Blender backup files are ignored.

## Runtime contract / 运行约定

- Metres; Blender +Z up exports to glTF +Y up, employee facing +Z.
- LOD0: ~37.3k triangles; LOD1: ~11.9k triangles, including glasses and one hairstyle. Alternative hairstyles are hidden, not rendered together.
- Nine deform bones: root, spine, head, two shoulders, two elbows and two wrists. All geometry has normals, UVs and skin weights; export validation rejects non-manifold edges.
- Shared geometry/textures; per-employee materials and skeletons. Stable ID-derived appearance. LOD uses projected head size, including in large workgroups.
- Base cloth/skin colours are tinted at runtime. The neutral Blender preview is not a screenshot of the application's final lighting/materials.
- Typing/review/mouse gestures are driven by confirmed observed status. They illustrate activity; they are not captures of real gestures or internal reasoning.
- Failed model loading retains the procedural fallback. High fidelity uses contact shadows and high-DPI MSAA rendering; Performance disables AO and caps render scale.

## QA / 验收

Run Python tests and `node tests/office-quality.browser.cjs` as described in `../../tests/README.md`. Inspect the generated three-quarter/profile Blender renders and actual browser office/cell close-ups. Browser validation also covers offline loading, live-status animation, reduced motion, picking, LOD, both quality modes and resource reuse. Counts do not by themselves establish visual quality: review the actual rendered scene.

## Animal coworkers / 牛马同事

The office mixes humans with two original anthropomorphic coworkers: a black-and-white cow with short ivory horns and a chestnut horse with a dark mane and white blaze. Both wear the existing tailored office outfit and sit at the same desk and keyboard. Character assignment is derived from the agent ID and stays stable across status refreshes and scene changes; species is only an appearance and conveys no role, capability or activity.

办公室在原有人物中加入黑白奶牛与栗色马同事，沿用办公衬衫、坐姿与九骨骼动作。角色外观由 Agent ID 稳定决定；刷新状态、切换场景时不会更换形象，也不改变身份和统计。

- `office-cow.blend`, `office-horse.blend`: editable source with separate named geometry, shared body rig, coat vertex colours, high/low geometry and look-dev camera/lights.
- `../../dashboard/assets/office-cow.glb`, `../../dashboard/assets/office-horse.glb`: self-contained runtime assets, embedded in the HTML alongside the human.
- Matching `office-cow.validation.json` and `office-horse.validation.json`: geometry, UV, bone and triangle-budget evidence.
- `../../scripts/build_office_animals.py`: deterministic authoring script; reads `office-employee.blend` without modifying it. Requires that source asset to exist. No external assets or accounts.

```bash
blender --background --factory-startup --python-exit-code 1 --python scripts/build_office_animals.py
```

For one character, append `-- --species cow` or `-- --species horse`; append `--no-render` after `--` to skip only the look-dev renders. Source/export files are replaced on rebuilding; the open Blender document is untouched. Preview PNGs and logs stay in ignored `work/`.

Production budget: at most 40,000 triangles per character at LOD0, under 40% at LOD1, 2K shared fabric textures, metres, floor pivot, glTF +Y up and +Z forward. Fur/coat colours remain authored; clothing receives the existing per-agent tint. The same status-driven typing/review/mouse gestures and reduced-motion behavior apply to all three species. Cow/horse model failure falls back independently so other coworkers remain usable.
