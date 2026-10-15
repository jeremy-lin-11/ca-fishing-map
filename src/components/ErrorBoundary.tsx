import { Component, type ReactNode } from 'react';

// Keeps one failing panel (or the map) from blanking the whole app.
export default class ErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[${this.props.name}]`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card crash" role="alert">
        <h3>Something went wrong in the {this.props.name}</h3>
        <p className="hint">{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>{' '}
        <button type="button" onClick={() => window.location.reload()}>Reload the app</button>
      </div>
    );
  }
}
