export function WorkspaceSkeleton() {
  return <div className="studio-content-grid" aria-busy="true" role="status"><span className="sr-only">저장한 콘텐츠를 불러오는 중</span>{[0,1,2].map(index => <div className="creative-skeleton-card" key={index} aria-hidden="true"><div className="creative-skeleton-art"/><div className="creative-skeleton-copy"><i/><strong/><strong/><small/></div></div>)}</div>;
}
