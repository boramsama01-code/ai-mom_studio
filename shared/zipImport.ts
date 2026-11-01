import { unzipSync } from "fflate";

export const ZIP_MAX_BYTES = 100 * 1024 * 1024;
export const ZIP_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export type ZipPost = { folder: string; title: string; caption: string; pages: Array<{ name: string; bytes: Uint8Array }> };
export type ZipImportResult = { imported: number; skipped: number; pageCount: number; cards: Array<{ id: number; title: string; pages: number; duplicate: boolean; trashed: boolean }> };
const natural = new Intl.Collator("ko", { numeric: true, sensitivity: "variant" });
const label = (name: string) => name.replace(/^\d+[\s_.-]+/, "").replace(/_/g, " ").trim() || name;
const key = (name: string) => label(name).replace(/\s/g, "");

/** No paths are written to disk. Limit allocations before decompressing any selected entry. */
export function readCardNewsZip(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > ZIP_MAX_BYTES) throw new Error("ZIP은 100MB 이하로 선택해 주세요.");
  const names = new Set<string>();
  let total = 0, entries = 0, ignored = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: file => {
      if (++entries > 500) throw new Error("ZIP 안의 파일이 너무 많습니다. 500개 이하로 나눠 주세요.");
      const name = file.name.normalize("NFC");
      if (name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").some(p => p === ".." || p === ".") || /[\u0000-\u001f]/.test(name)) throw new Error("ZIP에 올바르지 않은 파일 경로가 있습니다.");
      if (name.endsWith("/")) return false;
      if (names.has(name)) throw new Error("ZIP 안에 같은 이름의 파일이 중복되어 있습니다.");
      names.add(name);
      if (name.split("/").some(p => p.startsWith(".") || p === "__MACOSX")) { ignored++; return false; }
      const image = /\.(png|jpe?g|webp)$/i.test(name);
      const text = /\.(txt|md)$/i.test(name);
      if (!image && !text) { ignored++; return false; }
      if (![0, 8].includes(file.compression)) throw new Error("지원하지 않는 ZIP 압축 방식입니다. 일반 ZIP으로 다시 저장해 주세요.");
      const limit = image ? ZIP_IMAGE_MAX_BYTES : 128 * 1024;
      if (file.originalSize > limit || file.size > limit || file.originalSize < 1) throw new Error(image ? "이미지는 한 장에 12MB 이하로 준비해 주세요." : "설명 파일은 128KB 이하로 준비해 주세요.");
      total += file.originalSize;
      if (total > ZIP_MAX_BYTES) throw new Error("압축을 푼 파일의 합계가 100MB를 넘습니다. ZIP을 나눠 주세요.");
      return true;
    } });
  } catch (error) {
    if (error instanceof Error && /ZIP|파일|이미지|설명/.test(error.message)) throw error;
    throw new Error("ZIP을 읽을 수 없습니다. 암호 없는 일반 ZIP인지 확인해 주세요.");
  }
  const groups = new Map<string, ZipPost>();
  const texts: Array<{ name: string; text: string }> = [];
  for (const [raw, data] of Object.entries(files)) {
    const name = raw.normalize("NFC"), parts = name.split("/"), filename = parts.pop()!, folder = parts.join("/");
    if (/\.(txt|md)$/i.test(name)) { texts.push({ name, text: new TextDecoder().decode(data).replace(/^\uFEFF/, "") }); continue; }
    const group = groups.get(folder) ?? { folder, title: label(parts.at(-1) || "완성 카드뉴스"), caption: "", pages: [] };
    group.pages.push({ name, bytes: data }); groups.set(folder, group);
  }
  const posts = [...groups.values()].sort((a, b) => natural.compare(a.folder, b.folder));
  if (!posts.length) throw new Error("ZIP에서 PNG·JPG·WEBP 이미지를 찾지 못했습니다.");
  if (posts.length > 20) throw new Error("한 번에 게시물 20건까지 가져올 수 있습니다.");
  const sections = new Map<string, string>();
  for (const { text } of texts) {
    const matches = [...text.matchAll(/^\[([^\]\r\n]+)\][ \t]*\r?$/gm)];
    matches.forEach((m, i) => sections.set(key(m[1]), text.slice(m.index! + m[0].length, matches[i + 1]?.index ?? text.length).trim()));
  }
  for (const post of posts) {
    post.pages.sort((a, b) => natural.compare(a.name, b.name));
    if (post.pages.length > 10) throw new Error(`‘${post.title}’에 ${post.pages.length}장이 있습니다. 게시물마다 폴더를 나누고 최대 10장씩 넣어 주세요.`);
    const own = texts.find(t => t.name.split("/").slice(0, -1).join("/") === post.folder && /(?:caption|캡션|게시글)[^/]*\.txt$/i.test(t.name));
    post.caption = sections.get(key(post.title)) ?? (own && !/^\[/m.test(own.text) ? own.text.trim() : "");
    if (post.title.length > 160 || post.caption.length > 8000) throw new Error("제목 또는 게시글이 너무 깁니다. ZIP 안의 글을 줄여 주세요.");
  }
  return { posts, notes: texts.filter(t => /readme/i.test(t.name)).map(t => t.text).join("\n\n").slice(0, 12000), ignored, pageCount: posts.reduce((n, p) => n + p.pages.length, 0) };
}
