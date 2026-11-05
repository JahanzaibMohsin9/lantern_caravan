import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import { App } from "./ui/App";
import "./ui/style.css";

createRoot(document.getElementById("root")!).render(<App/>);
