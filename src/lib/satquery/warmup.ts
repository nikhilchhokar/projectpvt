/**
 * Scene warm-up.
 *
 * Generating a scene and classifying it costs a few hundred milliseconds, all
 * of it cacheable and none of it worth paying while a judge is watching. The
 * server does that work once at startup so the first question of a demo is as
 * fast as the fifth.
 */

import { classifyCached } from "./landcover";
import { generateScene, listSceneKeys } from "./scene";

let started = false;

export function warmScenes(): void {
  if (started) return;

  // Route modules are imported during prerendering too, where warming buys
  // nothing and costs the build a scene generation per worker.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  started = true;

  // Deferred so module import stays cheap and the server can start accepting
  // connections immediately.
  setTimeout(() => {
    const began = Date.now();
    for (const key of listSceneKeys()) {
      const scene = generateScene(key);
      if (scene.modality === "optical") classifyCached(scene);
    }
    console.log(`[satquery] warmed ${listSceneKeys().length} scenes in ${Date.now() - began}ms`);
  }, 0);
}
