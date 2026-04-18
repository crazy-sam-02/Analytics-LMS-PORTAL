import { Component } from "react";
import { Button } from "@/components/ui/button";

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || "Something went wrong.",
    };
  }

  componentDidCatch(error, info) {
    // Keep this for production diagnostics integration.
    if (typeof console !== "undefined") {
      console.error("AppErrorBoundary", error, info);
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      errorMessage: "",
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <article className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Unexpected error</h1>
          <p className="mt-3 text-sm text-slate-600">{this.state.errorMessage}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={this.handleRetry}>Retry</Button>
            <Button type="button" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </article>
      </section>
    );
  }
}

export default AppErrorBoundary;
