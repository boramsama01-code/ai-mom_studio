import { useEffect, useState } from "react";
export function BrandAssetPreview({ src, name, accent, background }: { src: string | null; name: string; accent: string; background?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <div className="brand-asset-preview" style={{ backgroundColor: failed ? undefined : background }}>
    {src && !failed ? <img src={src} alt={name+" 등록 로고"} onError={() => setFailed(true)}/> : <span className="brand-asset-name" style={{ color: accent }}>{name}</span>}
    {failed && <p role="status">로고를 불러오지 못했습니다.<br/>저장된 설정은 유지됩니다. 브랜드 설정에서 주소를 확인해 주세요.</p>}
  </div>;
}
