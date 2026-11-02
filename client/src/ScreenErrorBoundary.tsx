import { Component, type ReactNode } from "react";

/** Keep navigation usable if an older open tab requests a removed deployment chunk. */
export class ScreenErrorBoundary extends Component<{
  children: ReactNode;
  onReload: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="panel stack" role="alert">
      <h1>화면을 불러오지 못했어요</h1>
      <p className="muted">업데이트 뒤 오래 열어 둔 화면이거나 일시적인 연결 문제일 수 있습니다. 현재 주소에서 최신 화면을 다시 불러와 주세요.</p>
      <div><button className="btn primary" onClick={this.props.onReload}>최신 화면 불러오기</button></div>
    </section>;
  }
}
