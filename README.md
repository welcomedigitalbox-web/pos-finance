# Finance — Edu Baby House

POS ရဲ့ **Supabase project တစ်ခုတည်း**ကို မျှသုံးတဲ့ သီးသန့် accounting app။
Double-entry ledger, voucher entry, receivable/payable, cashbook/bank, document chain ပါဝင်တယ်။

POS repo: `welcomedigitalbox-web/pos` — ဒီ app က အဲဒီ `profiles`, `stores`, `customers`,
`suppliers`, `products`, `sales` table တွေကို ဖတ်ပြီး၊ `fin_*` table တွေကို ကိုယ်ပိုင် ထားတယ်။

## Setup

```bash
npm install
cp .env.example .env.local     # POS နဲ့ တူညီတဲ့ Supabase URL + anon key ထည့်ပါ
npm run dev
```

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

⚠️ POS နဲ့ **တူညီတဲ့ project ref** ဖြစ်ရမယ် — မတူရင် login နဲ့ data မတွေ့ပါ။

## Database

`supabase/migrations/20260907000001_finance_module.sql` ကို Supabase SQL Editor မှာ
တစ်ခါ run ပါ (POS baseline schema ရှိပြီးသား project မှာသာ run ရမယ် — `profiles`,
`stores`, `sales`, `can_read_store()` စတာတွေကို မှီခိုတယ်)။ ထပ် run လည်း အန္တရာယ် မရှိ (idempotent)။

Run ပြီးရင်:
- Chart of Accounts ၂၅ ခေါင်းစဉ် (မြန်မာ/အင်္ဂလိပ်) နဲ့ posting rule တွေ ဝင်လာမယ်
- `finance_manager` / `accountant` / `owner` / `operation_director` role တွေ page permission ရမယ်

## Account များ — POS နဲ့ လုံးဝ သီးခြား

Finance က ကိုယ်ပိုင် staff list (`fin_users`) ထားတယ်။ POS ရဲ့ `profiles` ကို လုံးဝ မဖတ်ပါ။

- POS အကောင့်နဲ့ ဒီ app ကို ဝင်လို့ **မရ** — `fin_users` row မရှိရင် "Finance အကောင့် မဟုတ်ပါ" ပဲ ပြမယ်
- Finance အကောင့်နဲ့ POS ကို ဝင်လို့ **မရ** — `profiles` row မရှိလို့
- Supabase Auth ကတော့ project တစ်ခုတည်း ဖြစ်လို့ email ချင်း မတူစေရ (တစ်ယောက်တည်း နှစ်ဘက်လုံး
  သုံးချင်ရင် email နှစ်ခု သုံးပါ)

### Role

| Role | ဘာရလဲ |
|---|---|
| `fin_admin` | အားလုံး + finance အကောင့်များ စီမံခြင်း |
| `fin_manager` | အားလုံး (အကောင့် စီမံခြင်း မပါ), ဆိုင်ခွဲ အားလုံး |
| `accountant` | ခွင့်ပြုထားတဲ့ စာမျက်နှာနဲ့ ဆိုင်ခွဲများသာ |
| `viewer` | ဖတ်ရုံသာ — database က post လုပ်ခွင့် ပိတ်ထားတယ် |

### ပထမဆုံး admin ဆောက်နည်း

1. Supabase Dashboard → Authentication → Users → Add user (email + password, Auto Confirm ✓)
2. SQL Editor မှာ:
   ```sql
   select public.fin_bootstrap_admin('finance@yourcompany.com');
   ```
3. ဒီ app ကို အဲဒီ email နဲ့ ဝင်ပြီး **Users** စာမျက်နှာမှာ ကျန်တဲ့ဝန်ထမ်းတွေ ဆက်ဆောက်ပါ။

### Edge function

`supabase/functions/fin-admin-create-user` ကို deploy လုပ်ရမယ် (အကောင့် ဆောက်/ဖျက်ရန်
service role လိုလို့ browser ကနေ တိုက်ရိုက် မလုပ်နိုင်ပါ):

```bash
supabase functions deploy fin-admin-create-user
```

## စာမျက်နှာများ

| Route | ဘာလုပ်လဲ |
|---|---|
| `/` | AR / AP / Cash / Bank အနှစ်ချုပ်, ageing, POS sale ဆွဲယူခြင်း |
| `/vouchers` | Sale / Purchase / Income / Expense voucher (unpaid–paid, trade + cash discount) |
| `/payments` | ငွေလက်ခံ / ငွေပေး + voucher အလိုက် allocation |
| `/documents` | Quotation → PO → GDN → Invoice → CN/DN → Remittance → Receipt → Statement |
| `/receivables`, `/payables` | ageing နဲ့ တစ်ချက်တည်း ငွေရှင်း |
| `/cashbook`, `/bank` | ဆိုင်ခွဲအလိုက် ငွေသား / ဘဏ် စာအုပ် |
| `/journal` | လက်ဖြင့် double-entry (မညီရင် DB က ပယ်) |
| `/general-ledger`, `/trial-balance` | Ledger + running balance, trial balance |
| `/accounts` | Chart of Accounts + posting rules |
| `/import` | Excel (CSV) မှ voucher / account သွင်းခြင်း |

## Posting rules

| ဖြစ်ရပ် | Debit | Credit |
|---|---|---|
| Sale voucher | AR 1200 | Sales 4000/4010/4020 + Tax 2100 |
| Purchase voucher | Purchases 5100 + Tax | AP 2000 |
| Receipt | Cash/Bank + Discount Allowed 5200 | AR |
| Payment | AP | Cash/Bank + Discount Received 4200 |
| Cashbook / Bank | ရွေးထားသော contra account | Cash/Bank |

- Journal ကို UI က မဆောက်ပါ — RPC (`fin_save_voucher`, `fin_record_payment`,
  `fin_save_cash_entry`, `fin_save_journal`) ကပဲ ဆောက်တယ်။
- Debit ≠ Credit ဖြစ်ရင် database က ပယ်တယ် (`fin_assert_balanced`)။
- စာရင်း မှားရင် ဖျက်လို့ မရ — `fin_reverse_journal` နဲ့ ပြန်ဖျက်စာရင်း ထုတ်ပါ။
- Trade discount = invoice ပေါ်မှာ ချက်ချင်း နုတ်။ Cash discount = ငွေရှင်းချိန်မှသာ 5200/4200 သွား။

## POS ဘက်ကို ဘာလုပ်လဲ

ဖတ်ရုံသာ — `stores`, `products`, `suppliers`, `customers`, `sales_reps`, `sales`,
`sale_items` (ဆိုင်ခွဲအလိုက် scope)။ POS table တစ်ခုမှ မရေးပါ။ POS ဘက်က ဘာမှ မပြောင်းပါ
(policy အသစ် ထပ်ထည့်ရုံသာ)。

## POS sale တွေ ဆွဲယူခြင်း

`/` မှာ ရက်အပိုင်းအခြား ရွေးပြီး "POS အရောင်းများ သွင်းမည်" နှိပ်ပါ။
POS sale တစ်ခုကို voucher တစ်ခုပဲ ဆောက်တယ် (ထပ်နှိပ်လည်း မထပ်ပါ)၊
POS table တွေကို ဘာမှ မပြင်ပါ။

## Deploy

Vercel မှာ project အသစ် တစ်ခု — env var နှစ်ခု ထည့်ပြီး `git push` နဲ့ deploy။
POS app နဲ့ သီးခြား deploy ဖြစ်တယ်၊ database ကတော့ တစ်ခုတည်း။

## မလုပ်ရသေး

COGS auto-post (stock ledger ချိတ်ရန်), P&L / Balance Sheet, year-end closing,
bank reconciliation, multi-currency (အခု MMK တစ်မျိုးတည်း)。
