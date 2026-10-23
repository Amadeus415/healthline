"use client";

import dynamic from "next/dynamic";

// The team view keeps its case in localStorage, so it renders in the browser only.
export const ClientTeam = dynamic(() => import("./TeamApp").then((m) => m.TeamApp), { ssr: false });
