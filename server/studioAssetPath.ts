import path from "node:path";

const PRIVATE_POSE_ROOT = "/studio-assets/poses-v2";

/** Match the decode-once/path-normalization behavior used by Express static file serving. */
export function isPrivateStudioAssetPath(pathname: string): boolean {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { return false; } // The static server rejects malformed escapes instead of serving a file.
  const normalized = path.posix.normalize(`/${decoded}`);
  return normalized === PRIVATE_POSE_ROOT || normalized.startsWith(`${PRIVATE_POSE_ROOT}/`);
}
