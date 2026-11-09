import type { StudioCard } from "@shared/studio";
import { ItemDetailPage } from "./ItemDetail";
import {NotionLinkedDocument} from './NotionSync';
import {GuardedLink} from '../ui';

/** Source-based cards have one editor, regardless of which list opened them. */
export function SourceStudioCard({ card, embedded = false }: { card: StudioCard; embedded?: boolean }) {
  if(card.notionLinkId&&card.channel==='highscoop')return <div className="notion-linked-studio stack"><header className="row between"><h1>하이스쿱 카드 편집</h1><GuardedLink className="btn" href="/">내 콘텐츠로 돌아가기</GuardedLink></header><NotionLinkedDocument key={card.notionLinkId} id={card.notionLinkId}/></div>;
  const source = card.sourceReference ?? card.sourceOutput;
  if (!source) return null;
  return <div className={embedded ? "source-output-panel" : "source-output-detail"}>
    <ItemDetailPage cid={source.channelId} id={source.itemId} fromStudio />
  </div>;
}
