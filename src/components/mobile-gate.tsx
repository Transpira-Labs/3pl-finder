"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

export function MobileGate({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 768);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (isMobile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-center">
        <div>
          <Monitor className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="mt-4 text-lg font-semibold">Desktop Only</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This app is designed for desktop.
            <br />
            Please open on a computer.
          </p>
          <p className="mt-3 text-xs text-muted-foreground/60">
            Esta aplicacion esta disenada para escritorio.
            <br />
            Por favor, abrela en una computadora.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
