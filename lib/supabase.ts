import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// The POS tables this app reads. It writes to none of them - finance owns
// the fin_* tables and nothing else.

export type StoreRow = {
  id: string;
  name: string;
  is_warehouse: boolean;
  is_active: boolean;
  region: string | null;
};

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  store_id: string;
  is_active: boolean;
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  store_id: string;
};

export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
};

export type SalesRep = {
  id: string;
  name: string;
  store_id: string | null;
  is_active: boolean;
};
