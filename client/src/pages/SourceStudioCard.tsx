import type { StudioCard } from "@shared/studio";
import { ItemDetailPage } from "./ItemDetail";

/** Source-based cards have one editor, regardless of which list opened them. */
export function SourceStudioCard({ card, embedded = false }: { card: StudioCard; embedded?: boolean }) {
  const output = card.sourceOutput!;
  return <div className={embedded ? "source-output-panel" : "source-output-detail"}>
    <ItemDetailPage cid={output.channelId} id={output.itemId} fromStudio />
  </div>;
}
