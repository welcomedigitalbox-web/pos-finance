"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase, StoreRow } from "@/lib/supabase";
import { useAuth } from "./auth-context";
import { coversAllStores } from "./permissions";

type StoreContextType = {
  storeId: string;
  setStoreId: (id: string) => void;
  stores: StoreRow[];
  refreshStores: () => Promise<void>;
  isStoreLocked: boolean;
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { profile, stores: allowed } = useAuth();
  const [storeId, setStoreIdState] = useState("");
  const [stores, setStores] = useState<StoreRow[]>([]);

  // An account with one branch cannot switch away from it; the ledger's
  // RLS enforces the same scope, so the selector only reflects it.
  const isStoreLocked = stores.length <= 1;

  async function refreshStores() {
    if (!profile) {
      setStores([]);
      return;
    }

    const { data } = await supabase
      .from("stores")
      .select("*")
      .eq("is_active", true)
      .order("name");

    const rows = (data as StoreRow[]) || [];
    const visible = coversAllStores(profile)
      ? rows
      : rows.filter((s) => allowed.includes(s.id));

    setStores(visible);
    if (visible.length > 0 && !visible.some((s) => s.id === storeId)) {
      setStoreIdState(visible[0].id);
    }
  }

  useEffect(() => {
    refreshStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, allowed.join(",")]);

  function setStoreId(id: string) {
    setStoreIdState(id);
  }

  return (
    <StoreContext.Provider value={{ storeId, setStoreId, stores, refreshStores, isStoreLocked }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
