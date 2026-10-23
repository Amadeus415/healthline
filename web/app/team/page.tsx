import type { Metadata } from "next";
import { ClientTeam } from "@/components/ClientTeam";

export const metadata: Metadata = {
  title: "Healthline · Team",
  description: "One Cortex Agent for the paramedic, the doctor and the nurse on the same case.",
};

export default function Page() {
  return <ClientTeam />;
}
