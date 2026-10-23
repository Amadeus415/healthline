"use client";

import dynamic from "next/dynamic";

// The app keeps its cases in localStorage, so it renders in the browser only.
export const ClientApp = dynamic(() => import("./App").then((m) => m.App), { ssr: false });
