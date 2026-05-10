import { useEffect } from "react";
import { useNavigate } from "react-router";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/forgot-password", { replace: true });
  }, [navigate]);
  return null;
}
