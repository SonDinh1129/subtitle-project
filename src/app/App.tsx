import { RouterProvider } from "react-router";
import { router } from "./routes";
import { UiPreferencesProvider } from "./context/UiPreferencesContext";

export default function App() {
  return (
    <UiPreferencesProvider>
      <RouterProvider router={router} />
    </UiPreferencesProvider>
  );
}
