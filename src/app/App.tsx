import { RouterProvider } from "react-router";
import { router } from "./routes";
import { UiPreferencesProvider } from "./context/UiPreferencesContext";
import { AuthProvider } from "./context/AuthContext";

export default function App() {
  return (
    <UiPreferencesProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </UiPreferencesProvider>
  );
}
