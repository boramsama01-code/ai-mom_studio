import { CollectionPanel } from "../collection";
import { useChannel } from "../state";

export function TodayPage() {
  const { selected, select, current } = useChannel();
  return <>
    <div className="page-head"><div><h1>아침 수집 브리핑</h1><p className="muted small">{selected === "all" ? "모든 채널" : current?.name}의 날짜별 신규 자료와 실행 결과입니다.</p></div>{selected !== "all" && <button className="btn" onClick={() => select("all")}>모든 채널 보기</button>}</div>
    <CollectionPanel detailed />
  </>;
}
