"use client";
import dynamic from "next/dynamic";

// The dashboard is a fully client-side app (live clock, Three.js, localStorage
// sessions). Rendering it only on the client removes server/client hydration
// mismatches (React errors 418/423/425) without changing anything visual.
const Dashboard = dynamic(() => import("@/components/Dashboard"), { ssr: false });

export default function Home() { return <Dashboard />; }
