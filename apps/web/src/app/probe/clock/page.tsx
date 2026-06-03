/**
 * /probe/clock — Glass-to-Glass latency probe: full-screen millisecond UTC clock.
 *
 * Server component wrapper: exports `metadata`, renders the client clock.
 */
import type { Metadata } from "next";
import { ClockProbe } from "./ClockProbe";

export const metadata: Metadata = {
  title: "G2G Probe — Clock",
  description:
    "Full-screen millisecond UTC clock for glass-to-glass latency measurement. Point a camera at this screen.",
};

export default function ClockProbePage() {
  return <ClockProbe />;
}
