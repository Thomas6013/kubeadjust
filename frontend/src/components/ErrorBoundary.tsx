"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "1.5rem", color: "var(--red)", fontSize: "0.85rem" }}>
          <strong>{this.props.fallback ?? "An error occurred."}</strong>
          <br />
          <span style={{ color: "var(--muted)" }}>{this.state.error.message}</span>
          <br />
          <button
            type="button"
            onClick={this.reset}
            style={{ marginTop: "0.75rem", cursor: "pointer", fontSize: "0.8rem" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
