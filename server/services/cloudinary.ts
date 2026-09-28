/**
 * Cloudinary 업로드 — 승인 대상 버전의 고정 이미지만 올린다.
 * Instagram은 외부에서 읽히는 HTTPS JPEG URL이 필요하다.
 */
import { v2 as cloudinary } from "cloudinary";
import { env } from "../env";

export class CloudinaryNotConfigured extends Error {
  constructor() {
    super("Cloudinary 미연결(CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET 필요)");
  }
}

let configured = false;
function ensure() {
  if (!env.cloudinaryConfigured) throw new CloudinaryNotConfigured();
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
}

export async function uploadCard(jpeg: Buffer, publicId: string): Promise<{ publicId: string; url: string; bytes: number }> {
  ensure();
  const res = await new Promise<{ public_id: string; secure_url: string; format: string; bytes: number }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: "image", overwrite: false, unique_filename: false, format: "jpg" },
      (err, result) => (err || !result ? reject(err ?? new Error("업로드 실패")) : resolve(result as never)),
    );
    stream.end(jpeg);
  });
  if (!res.secure_url.startsWith("https://")) throw new Error("Cloudinary URL이 HTTPS가 아님");
  if (res.format !== "jpg") throw new Error(`Cloudinary 형식이 JPEG가 아님(${res.format})`);
  return { publicId: res.public_id, url: res.secure_url, bytes: res.bytes };
}
