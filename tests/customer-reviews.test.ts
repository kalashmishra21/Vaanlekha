import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "20261007000100_initial_business.sql", "20261008071313_hardening_indexes.sql",
  "20261008090000_demo_shop_reset.sql", "20261008160000_assistant_open_khata.sql",
  "20261008190000_suppliers_purchase_orders.sql", "20261008190256_purchase_order_items_shop_index.sql",
  "20261010090000_mutation_idempotency_and_rate_limits.sql", "20261010100000_assistant_pending_clarifications.sql",
  "20261010110000_order_transition_confirmation_guard.sql", "20261010182851_assistant_conversations.sql",
  "20261028170000_fractional_kirana_quantities.sql", "20261028191500_sale_linked_customer_reviews.sql",
];
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const tokenHash = "a".repeat(64);

describe("sale-linked customer reviews", () => {
  it("requires a real sale, restricts invites to the owner, and accepts one anonymous response", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create schema auth;
        create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        alter default privileges in schema public grant all on tables to authenticated;`);
      for (const file of migrations) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
      await db.exec(`grant usage on schema public, auth to authenticated, anon;
        insert into auth.users(id,raw_user_meta_data) values ('${owner}','{}'),('${other}','{}');
        set role authenticated; set request.jwt.claim.sub = '${owner}';`);
      const shop = (await db.query<{ id: string }>("select public.bootstrap_demo_shop() id")).rows[0].id;
      const product = (await db.query<{ id: string }>(`select public.create_product('${shop}', 'Review QA product', null, 'packet', 25, null, 1, 5) id`)).rows[0].id;
      const sale = (await db.query<{ id: string }>(`select (public.record_sale_decimal_idempotent('${shop}',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"productId":"${product}","quantity":1}]'::jsonb, 'cash')->>'saleId')::uuid id`)).rows[0].id;
      await expect(db.query(`select public.issue_review_invite('${shop}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${tokenHash}')`)).rejects.toThrow();
      await db.exec(`set request.jwt.claim.sub = '${other}';`);
      await expect(db.query(`select public.issue_review_invite('${shop}', '${sale}', '${tokenHash}')`)).rejects.toThrow();
      await db.exec(`set request.jwt.claim.sub = '${owner}';`);
      await db.query(`select public.issue_review_invite('${shop}', '${sale}', '${tokenHash}')`);
      await db.exec("reset role; set role anon;");
      const details = await db.query<{ data: { shopName: string } }>(`select public.review_invite_details('${tokenHash}') data`);
      expect(details.rows[0].data.shopName).toBeTruthy();
      const saved = await db.query<{ id: string }>(`select public.submit_customer_review('${tokenHash}', 5, 'Helpful visit', 'QA Customer') id`);
      expect(saved.rows[0].id).toMatch(/^[a-f0-9-]{36}$/u);
      await expect(db.query(`select public.submit_customer_review('${tokenHash}', 1, 'Duplicate', 'Other')`)).rejects.toThrow();
      expect((await db.query<{ data: unknown }>(`select public.review_invite_details('${tokenHash}') data`)).rows[0].data).toBeNull();
      await expect(db.query("select * from public.customer_reviews")).rejects.toThrow();
      await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${other}';`);
      expect((await db.query("select * from public.customer_reviews")).rows).toHaveLength(0);
      await db.exec(`set request.jwt.claim.sub = '${owner}';`);
      expect((await db.query<{ comment: string }>("select comment from public.customer_reviews")).rows).toEqual([{ comment: "Helpful visit" }]);
    } finally { await db.close(); }
  }, 30_000);
});
