import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "20261007000100_initial_business.sql", "20261008071313_hardening_indexes.sql",
  "20261008090000_demo_shop_reset.sql", "20261008160000_assistant_open_khata.sql",
  "20261008190000_suppliers_purchase_orders.sql", "20261008190256_purchase_order_items_shop_index.sql",
  "20261010090000_mutation_idempotency_and_rate_limits.sql", "20261010100000_assistant_pending_clarifications.sql",
  "20261010110000_order_transition_confirmation_guard.sql", "20261010180000_assistant_conversations.sql",
  "20261028170000_fractional_kirana_quantities.sql",
];
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("fractional quantities in PostgreSQL", () => {
  it("stores 2.5 kg and ₹100 exactly, replays safely, and denies cross-shop writes", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create schema auth;
        create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        alter default privileges in schema public grant all on tables to authenticated;`);
      for (const file of migrations) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
      await db.exec(`grant usage on schema public, auth to authenticated;
        insert into auth.users(id,raw_user_meta_data) values ('${owner}','{}'),('${other}','{}');
        set role authenticated; set request.jwt.claim.sub = '${owner}';`);
      const shop = (await db.query<{ id: string }>("select public.bootstrap_demo_shop() id")).rows[0].id;
      const productKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const product = (await db.query<{ id: string }>(`select public.create_product_decimal_idempotent(
        '${shop}', '${productKey}', 'QA Sugar', null, 'kg', 40, null, 1, 10) id`)).rows[0].id;
      const saleKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const items = JSON.stringify([{ productId: product, quantity: 2.5, expectedUnitPrice: 40 }]);
      const sale = await db.query<{ result: { saleId: string; total: number } }>(`select public.record_sale_decimal_idempotent(
        '${shop}', '${saleKey}', '${items}'::jsonb, 'cash') result`);
      expect(sale.rows[0].result.total).toBe(100);
      const repeated = await db.query<{ result: { saleId: string; total: number } }>(`select public.record_sale_decimal_idempotent(
        '${shop}', '${saleKey}', '${items}'::jsonb, 'cash') result`);
      expect(repeated.rows[0].result).toEqual(sale.rows[0].result);
      const saved = await db.query<{ stock: string; quantity: string; line: string; movements: number }>(`
        select p.current_stock stock, si.quantity, si.line_total line,
          (select count(*)::integer from public.inventory_movements where product_id = p.id and movement_type = 'sale') movements
        from public.products p join public.sale_items si on si.product_id = p.id where p.id = '${product}'`);
      expect(saved.rows[0]).toEqual({ stock: "7.500", quantity: "2.500", line: "100.00", movements: 1 });
      await expect(db.query(`select public.record_sale_decimal_idempotent('${shop}',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        '[{"productId":"${product}","quantity":0.25,"expectedUnitPrice":41}]'::jsonb, 'cash')`)).rejects.toThrow();
      await expect(db.query(`select public.record_sale_decimal_idempotent('${shop}',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        '[{"productId":"${product}","quantity":0.25,"expectedUnitPrice":40.03}]'::jsonb, 'cash')`)).rejects.toThrow();
      const afterRejected = await db.query<{ stock: string; sales: number }>(`select current_stock stock,
        (select count(*)::integer from public.sale_items where product_id = '${product}') sales
        from public.products where id = '${product}'`);
      expect(afterRejected.rows[0]).toEqual({ stock: "7.500", sales: 1 });
      await expect(db.query(`update public.products set unit = 'packet' where id = '${product}'`)).rejects.toThrow();
      const adjusted = await db.query<{ stock: string }>(`select public.adjust_stock_decimal_idempotent('${shop}',
        'ffffffff-ffff-4fff-8fff-ffffffffffff', '${product}', 0.25, 'QA measured restock') stock`);
      expect(adjusted.rows[0].stock).toBe("7.750");
      const packet = (await db.query<{ id: string }>(`select public.create_product('${shop}', 'QA Packet', null, 'packet', 25, null, 1, 4) id`)).rows[0].id;
      await expect(db.query(`select public.record_sale_decimal_idempotent('${shop}',
        '99999999-9999-4999-8999-999999999999',
        '[{"productId":"${packet}","quantity":0.5}]'::jsonb, 'cash')`)).rejects.toThrow();
      const oddPrice = (await db.query<{ id: string }>(`select public.create_product('${shop}', 'QA Odd Price', null, 'kg', 40.03, null, 1, 4) id`)).rows[0].id;
      await expect(db.query(`select public.record_sale_decimal_idempotent('${shop}',
        '88888888-8888-4888-8888-888888888888',
        '[{"productId":"${oddPrice}","quantity":0.25}]'::jsonb, 'cash')`)).rejects.toThrow();
      await db.exec(`set request.jwt.claim.sub = '${other}';`);
      await expect(db.query(`select public.adjust_stock_decimal_idempotent('${shop}',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${product}', 0.5, 'Cross shop')`)).rejects.toThrow();
    } finally { await db.close(); }
  }, 30_000); // PGlite loads PostgreSQL and applies the migration chain in this test.
});
