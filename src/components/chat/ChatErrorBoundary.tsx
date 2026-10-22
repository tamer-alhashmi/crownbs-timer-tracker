"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ChatErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Chat System Error]:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Chat is temporarily unavailable. Please close and reopen it, or try again shortly. / تعذر استخدام المحادثة مؤقتًا. يرجى إغلاقها وإعادة فتحها أو المحاولة لاحقًا.
        </div>
      );
    }
    return this.props.children;
  }
}
