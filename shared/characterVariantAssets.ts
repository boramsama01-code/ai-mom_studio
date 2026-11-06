import { HIGHSCOOP_PROFILE_ASSET } from "./highscoopOutro";

/** Immutable artwork supplied by the operator. These are profile/ending assets,
 * not additional eight-page templates. Never regenerate or rewrite the originals. */
export const FAMILY_PROFILE_ASSET_ID = "character:family-profile:20261104-040741" as const;
export const FAMILY_ENDING_ASSET_IDS = [
  "character:family-ending:20261104-041541",
  "character:family-ending:20261104-041021",
  "character:family-ending:20261104-040743",
] as const;
export type FamilyEndingAssetId = typeof FAMILY_ENDING_ASSET_IDS[number];
export const FAMILY_ENDING_FIXED_TEXT = ["구독", "좋아요", "@spacepenguin.co"] as const;

type PreservedCharacterAsset = {
  id: string; label: string; kind: "profile" | "full_image"; revision: "latest" | "previous";
  createdAt: string; libraryId: string; publicUrl: string; serverPath: string;
  sha256: string; width: number; height: number; alt: string;
};
const publicRoot = "/studio-assets/character-variants/";
function asset<T extends PreservedCharacterAsset>(value: T): T { return value; }
export const FAMILY_PROFILE_ASSET = asset({
  id: FAMILY_PROFILE_ASSET_ID, label: "가족 프로필 · 최근 수정안", kind: "profile", revision: "latest",
  createdAt: "2026-11-04T04:07:41.308191Z", libraryId: "libfile_5e3a7a8c6c0081919db9f8d9eb34abf4",
  publicUrl: publicRoot + "family-profile-20261104.png", serverPath: "client/public" + publicRoot + "family-profile-20261104.png",
  sha256: "d89c574c2706656b6df6d094530dbc57becd8520b83df71574e10dfaf56336ed", width: 1254, height: 1254,
  alt: "투명 헬멧을 쓴 네 펭귄 가족. 엄마는 머스터드 숄, 아빠는 카메라, 첫째는 감자튀김, 막내는 파란 기타를 들고 있습니다.",
});
export const FAMILY_ENDING_ASSETS = [
  asset({
    id: FAMILY_ENDING_ASSET_IDS[0], label: "가족 엔딩 · 원형 테두리 없음", kind: "full_image", revision: "latest",
    createdAt: "2026-11-04T04:15:41.350595Z", libraryId: "libfile_0d14a62be5b48191874f0a2780af992d",
    publicUrl: publicRoot + "family-ending-20261104-1315.png", serverPath: "client/public" + publicRoot + "family-ending-20261104-1315.png",
    sha256: "b2b414e32b206a50ab0a6cf3de2fbdb18e6a4f84f60836f0b0e7664555b5e631", width: 1122, height: 1402,
    alt: "흰 바탕의 투명 헬멧 펭귄 네 가족. 원형 테두리 없이 아래에 구독, 좋아요 버튼과 @spacepenguin.co 계정이 있습니다.",
  }),
  asset({
    id: FAMILY_ENDING_ASSET_IDS[1], label: "가족 엔딩 · 원형 테두리·넓은 간격", kind: "full_image", revision: "previous",
    createdAt: "2026-11-04T04:10:21.517944Z", libraryId: "libfile_5dee60d2bae48191808bc7ce243ffe74",
    publicUrl: publicRoot + "family-ending-20261104-1310.png", serverPath: "client/public" + publicRoot + "family-ending-20261104-1310.png",
    sha256: "32bd2a29ecb2fca2e2b454354b0ec45ef1e1e8d5c35e45ce51b9d00b66611e87", width: 1122, height: 1402,
    alt: "원형 테두리 안의 펭귄 네 가족. 넓은 간격 아래 구독, 좋아요 버튼과 @spacepenguin.co 계정이 있습니다.",
  }),
  asset({
    id: FAMILY_ENDING_ASSET_IDS[2], label: "가족 엔딩 · 원형 테두리·좁은 간격", kind: "full_image", revision: "previous",
    createdAt: "2026-11-04T04:07:43.523259Z", libraryId: "libfile_cda84d2f7efc81919322ae4547f3e997",
    publicUrl: publicRoot + "family-ending-20261104-1307.png", serverPath: "client/public" + publicRoot + "family-ending-20261104-1307.png",
    sha256: "505323e3daa089353eee51e2653205d972fc85589831db6f2fdd1bdcd1001369", width: 1122, height: 1402,
    alt: "원형 테두리 안의 펭귄 네 가족 바로 아래에 구독, 좋아요 버튼과 @spacepenguin.co 계정이 있습니다.",
  }),
] as const;
export const CHARACTER_VARIANT_ASSETS = [FAMILY_PROFILE_ASSET, ...FAMILY_ENDING_ASSETS] as const;

/** The existing brand files retain their historical IDs and hashes. */
export const REGISTERED_PROFILE_ASSETS = [
  FAMILY_PROFILE_ASSET,
  HIGHSCOOP_PROFILE_ASSET,
  { id: "brand:allligodang:bw:20261104", label: "ALL 프로필", kind: "profile", previewBackground: "#222b2c", serverPath: "assets/branding/allligodang-bw.png", sha256: "743e3a9bddc5465a08970900eb078148c19aadedd80b55a328a2b4c0bfe25908" },
  { id: "brand:space-penguin-company:20261101", label: "우주펭귄상회 로고", kind: "profile", serverPath: "assets/branding/space-penguin-company.png", sha256: "a66350333b86e9e0c14981154e67e26218497ecc2942dc4b826f87a48fff55ad" },
] as const;
export type RegisteredProfileAssetId = typeof REGISTERED_PROFILE_ASSETS[number]["id"];
export function registeredProfileAsset(value: unknown) { return REGISTERED_PROFILE_ASSETS.find(asset => asset.id === value); }
export function isRegisteredProfileAssetId(value: unknown): value is RegisteredProfileAssetId { return !!registeredProfileAsset(value); }
export function familyEndingAsset(value: unknown) { return FAMILY_ENDING_ASSETS.find(asset => asset.id === value); }
/** A structural input avoids making the artwork registry depend on the copy schema. */
export function selectedFamilyEnding(pageId: string, design?: { outroPresentation?: { mode: string; assetId?: string } }) {
  return pageId === "outro" && design?.outroPresentation?.mode === "full_image" ? familyEndingAsset(design.outroPresentation.assetId) : undefined;
}
