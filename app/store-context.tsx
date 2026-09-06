"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase, StoreRow } from "@/lib/supabase";
import { useAuth } from "./auth-context";

const STORE_LOCKED_ROLES = ["cashier", "online_sale", "wholesale"];

type StoreContextType = {
  storeId: string;
  setStoreId: (id: string) => void;
  stores: StoreRow[];
  refreshStores: () => Promise<void>;
  isStoreLocked: boolean;
  warehouses: StoreRow[];
  defaultWarehouseId: string;
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [storeId, setStoreIdState] = useState("");
  const [stores, setStores] = useState<StoreRow[]>([]);

  const isStoreLocked = !!profile && STORE_LOCKED_ROLES.includes(profile.role);

  // Warehouses are just stores flagged as such, so a business can run several
  const warehouses = stores.filter((s) => s.is_warehouse);
  const defaultWarehouseId = warehouses[0]?.id || "";

  async function refreshStores() {
    const { data } = await supabase.from("stores").select("*").eq("is_active", true).order("name");
    setStores(data || []);

    // A locked account belongs to exactly one branch, and defaulting to the
    // first retail store here made pages read the wrong one until the profile
    // arrived - long enough for a cashier to see another branch's screen.
    if (isStoreLocked) return;

    if (data && data.length > 0 && !storeId) {
      const firstRetail = data.find((s) => !s.is_warehouse) || data[0];
      setStoreIdState(firstRetail.id);
    }
  }

  useEffect(() => {
    refreshStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // For cashier/online-sale/wholesale accounts, always pin the store to the one
  // assigned on their profile — they cannot switch stores.
  useEffect(() => {
    if (isStoreLocked && profile?.store_id) {
      setStoreIdState(profile.store_id);
    }
  }, [isStoreLocked, profile?.store_id]);

  function setStoreId(id: string) {
    if (isStoreLocked) return; // ignore attempts to change store for locked accounts
    setStoreIdState(id);
  }

  return (
    <StoreContext.Provider
      value={{ storeId, setStoreId, stores, refreshStores, isStoreLocked, warehouses, defaultWarehouseId }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
