import { CARDNEWS14_STYLE_IDS, readingProfileForTemplateKey } from "@shared/readingCardProfiles";
import { cardnews14Source } from "@shared/cardnews14Catalog";
import "./registeredCardDesigns.css";

/** These stored examples remain available without an OAuth account. They are not a live folder scan. */
export function RegisteredCardDesigns() {
  return <section className="panel stack" aria-label="등록된 카드뉴스 14종">
    <h2>등록된 카드뉴스 14종</h2>
    <p className="small muted">표지와 내지를 포함한 8장 세트입니다. 저장된 디자인 예시는 Canva 연결 전에도 볼 수 있고, 각 편집본을 바로 열 수 있습니다. Canva에서 이후 수정한 내용은 아래 자동 동기화 연결을 마친 뒤 반영됩니다.</p>
    <div className="registered-design-grid">{CARDNEWS14_STYLE_IDS.map(styleId => {
      const profile = readingProfileForTemplateKey(`cardnews14-${styleId}-v1`)!;
      const source = cardnews14Source(styleId);
      return <article className="registered-design-card" key={styleId}>
        <a href={`/cardnews14/${styleId}-cover.webp`} target="_blank" rel="noopener noreferrer" aria-label={`${profile.label} 표지 크게 보기`}><img src={`/cardnews14/${styleId}-cover.webp`} alt={`${profile.label} 표지 저장본`} loading="lazy" /></a>
        <strong>{profile.label}</strong><small className="muted">표지 + 내지 · 8장</small>
        <div className="row"><a className="btn sm" href={`/cardnews14/${styleId}.webp`} target="_blank" rel="noopener noreferrer">8장 보기</a><a className="btn sm" href={source.editUrl} target="_blank" rel="noopener noreferrer">Canva 편집 ↗</a></div>
      </article>;
    })}</div>
    <p className="small muted">콘텐츠 편집기의 ‘카드 디자인’에서 선택해 원고를 작성합니다. 채널의 기본 디자인은 오른쪽 위에서 채널을 선택한 뒤 설정할 수 있습니다.</p>
  </section>;
}
