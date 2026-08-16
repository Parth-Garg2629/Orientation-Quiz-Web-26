import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Landing } from "./pages/Landing.js";
import { Team } from "./pages/Team.js";
import { Admin } from "./pages/Admin.js";
import { Projector } from "./pages/Projector.js";

/**
 * AdminGuard: blocks direct URL navigation to /admin.
 * Access is only granted if:
 *   (a) The user went through the ADMIN123 code flow on the landing page
 *       (sets 'orientquiz_admin_access' in sessionStorage), OR
 *   (b) The user already has a valid admin session token from this tab session
 *       (set after a successful passcode auth, persists through page refresh)
 */
const AdminGuard: React.FC = () => {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const hasGateFlag = sessionStorage.getItem("orientquiz_admin_access") === "1";
    const hasSessionToken = !!sessionStorage.getItem("orientquiz_admin_token");
    setAllowed(hasGateFlag || hasSessionToken);
  }, []);

  if (allowed === null) return null; // brief flicker guard
  if (!allowed) return <Navigate to="/" replace />;
  return <Admin />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/team" element={<Team />} />
        <Route path="/admin" element={<AdminGuard />} />
        <Route path="/projector" element={<Projector />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
