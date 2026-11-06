"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "guirab-theme";
type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = event.newValue === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  const label = theme === "dark" ? "Modo claro" : "Modo escuro";
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* The current view still works when storage is unavailable. */ }
  }

  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={`Ativar ${label.toLocaleLowerCase("pt-BR")}`} title={`Ativar ${label.toLocaleLowerCase("pt-BR")}`}>{theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}<span>{label}</span></button>;
}
