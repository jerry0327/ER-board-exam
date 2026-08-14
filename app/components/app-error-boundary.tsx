"use client";

import { X } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unable to render the application", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="loading-page">
        <div className="loading-mark"><X /></div>
        <p>題庫資料暫時無法載入，請重新整理頁面。</p>
        <button className="outline-button" onClick={() => window.location.reload()}>重新載入</button>
      </main>
    );
  }
}
