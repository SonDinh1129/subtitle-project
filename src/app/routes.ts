import { createBrowserRouter } from "react-router";
import { Root } from "./Root";
import { LandingPage } from "./pages/LandingPage";
import { UploadPage } from "./pages/UploadPage";
import { EditorPage } from "./pages/EditorPage";
import { NotFound } from "./pages/NotFound";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: LandingPage },
      { path: "upload", Component: UploadPage },
      { path: "editor", Component: EditorPage },
      { path: "*", Component: NotFound },
    ],
  },
  // Auth routes — standalone (no Header/Footer)
  { path: "/signin", Component: SignInPage },
  { path: "/signup", Component: SignUpPage },
  { path: "/forgot-password", Component: ForgotPasswordPage },
]);