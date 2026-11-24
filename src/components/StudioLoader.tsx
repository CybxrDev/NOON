"use client";

import dynamic from "next/dynamic";
import { Logo } from "./Logo";

// The design is read from the query string in the browser, so the page stays static.
export const StudioLoader = dynamic(() => import("./Studio").then((m) => m.Studio), {
  ssr: false,
  loading: () => (
    <main className="loading">
      <Logo className="logo" />
    </main>
  ),
});
