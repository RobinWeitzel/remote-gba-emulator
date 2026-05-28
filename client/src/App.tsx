import { useRoute } from "./lib/router";
import { HomePage } from "./ui/HomePage";
import { PlayPage } from "./ui/PlayPage";
import { SessionPage } from "./ui/SessionPage";
import { SpikePage } from "./spike/SpikePage";
import { PrimitivesShowcase } from "./ui/PrimitivesShowcase";

export function App() {
  const route = useRoute();
  if (route.path === "/spike") return <SpikePage />;
  if (route.path === "/play") return <PlayPage />;
  if (route.path === "/primitives") return <PrimitivesShowcase />;
  if (route.path.startsWith("/s/")) return <SessionPage />;
  return <HomePage />;
}
