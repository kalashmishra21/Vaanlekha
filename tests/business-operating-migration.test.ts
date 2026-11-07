import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "20261007000100_initial_business.sql",
  "20261008071313_hardening_indexes.sql",
  "20261008090000_demo_shop_reset.sql",
  "20261008160000_assistant_open_khata.sql",
  "20261008190000_suppliers_purchase_orders.sql",
  "20261008190256_purchase_order_items_shop_index.sql",
  "20261010090000_mutation_idempotency_and_rate_limits.sql",
  "20261010100000_assistant_pending_clarifications.sql",
  "20261010110000_order_transition_confirmation_guard.sql",
  "20261010182851_assistant_conversations.sql",
  "20261028170000_fractional_kirana_quantities.sql",
  "20261107190000_business_operating_assistant.sql",
];

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("business operating assistant database migration", () => {
  it("preserves customer identity, atomically links credit sales, bounds repayments, and identifies orders", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        alter default privileges in schema public grant all on tables to authenticated;
      `);
      for (const file of migrations) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
      await db.exec(`
        grant usage on schema public, auth to authenticated;
        insert into auth.users(id, raw_user_meta_data) values ('${owner}', '{}'::jsonb), ('${other}', '{}'::jsonb);
        set role authenticated;
        set request.jwt.claim.sub = '${owner}';
      `);

      const shop = (await db.query<{ id: string }>("select public.bootstrap_demo_shop() id")).rows[0].id;
      const maggi = (await db.query<{ id: string; current_stock: number | string; selling_price: number | string }>(`
        select id, current_stock, selling_price from public.products where shop_id = '${shop}' and name = 'Maggi'
      `)).rows[0];
      const openingStock = Number(maggi.current_stock);
      const sellingPrice = Number(maggi.selling_price);
      const sameNameA = (await db.query<{ id: string }>(`select public.create_customer_idempotent(
        '${shop}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Rahul', null) id`)).rows[0].id;
      const sameNameB = (await db.query<{ id: string }>(`select public.create_customer_idempotent(
        '${shop}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Rahul', null) id`)).rows[0].id;
      expect(sameNameA).not.toBe(sameNameB);
      const identities = await db.query<{ count: number; distinct_codes: number }>(`
        select count(*)::integer count, count(distinct customer_code)::integer distinct_codes
        from public.customers where shop_id = '${shop}' and name = 'Rahul'
      `);
      expect(identities.rows[0]).toEqual({ count: 2, distinct_codes: 2 });

      const saleKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const items = JSON.stringify([{ productId: maggi.id, quantity: 2, expectedUnitPrice: sellingPrice }]);
      const saleA = (await db.query<{ result: { saleId: string; total: number; customerId: string } }>(`
        select public.record_credit_sale_idempotent('${shop}', '${saleKey}', '${sameNameA}', null, '${items}'::jsonb) result
      `)).rows[0].result;
      const saleReplay = (await db.query<{ result: { saleId: string; total: number; customerId: string } }>(`
        select public.record_credit_sale_idempotent('${shop}', '${saleKey}', '${sameNameA}', null, '${items}'::jsonb) result
      `)).rows[0].result;
      expect(saleReplay).toEqual(saleA);
      expect(saleA.customerId).toBe(sameNameA);
      expect(saleA.total).toBe(2 * sellingPrice);
      const savedSale = await db.query<{ sales: number; entries: number; sale_links: number; stock: number }>(`
        select
          (select count(*)::integer from public.sales where id = '${saleA.saleId}' and customer_id = '${sameNameA}') sales,
          (select count(*)::integer from public.khata_entries where sale_id = '${saleA.saleId}' and customer_id = '${sameNameA}') entries,
          (select count(*)::integer from public.khata_entries where sale_id = '${saleA.saleId}') sale_links,
          (select current_stock::integer from public.products where id = '${maggi.id}') stock
      `);
      expect(savedSale.rows[0]).toEqual({ sales: 1, entries: 1, sale_links: 1, stock: openingStock - 2 });
      const salesSummary = await db.query<{ summary: { total: number; count: number } }>(`
        select public.get_shop_sales_summary('${shop}', '2000-01-01T00:00:00Z', '3000-01-01T00:00:00Z') summary
      `);
      const expectedSummary = await db.query<{ total: string; count: number }>(`
        select coalesce(sum(total_amount), 0)::text total, count(*)::integer count
        from public.sales where shop_id = '${shop}'
      `);
      expect(salesSummary.rows[0].summary).toEqual({ total: Number(expectedSummary.rows[0].total), count: expectedSummary.rows[0].count });
      const salesBeforeFailedCredit = (await db.query<{ count: number }>(`select count(*)::integer count
        from public.sales where shop_id = '${shop}'`)).rows[0].count;
      await expect(db.query(`select public.record_credit_sale_idempotent(
        '${shop}', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', null, 'Rollback Customer',
        '[{"productId":"${maggi.id}","quantity":99999}]'::jsonb)`)).rejects.toThrow();
      const rollback = await db.query<{ customers: number; sales: number; stock: number }>(`
        select
          (select count(*)::integer from public.customers where shop_id = '${shop}' and name = 'Rollback Customer') customers,
          (select count(*)::integer from public.sales where shop_id = '${shop}') sales,
          (select current_stock::integer from public.products where id = '${maggi.id}') stock
      `);
      expect(rollback.rows[0]).toEqual({ customers: 0, sales: salesBeforeFailedCredit, stock: openingStock - 2 });

      const debtor = (await db.query<{ id: string }>(`select public.open_khata_account_idempotent(
        '${shop}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Repayment Test', 100) id`)).rows[0].id;
      await db.query(`select public.add_khata_entry_idempotent('${shop}',
        'ffffffff-ffff-4fff-8fff-ffffffffffff', '${debtor}', 'received', 40, 'partial')`);
      await expect(db.query(`select public.add_khata_entry_idempotent('${shop}',
        '99999999-9999-4999-8999-999999999999', '${debtor}', 'received', 61, 'overpayment')`)).rejects.toThrow(/exceeds the outstanding/i);
      const afterRejectedPayment = await db.query<{ entries: number; balance: string }>(`
        select count(*)::integer entries,
          sum(case when type = 'gave' then amount else -amount end)::text balance
        from public.khata_entries where shop_id = '${shop}' and customer_id = '${debtor}'
      `);
      expect(afterRejectedPayment.rows[0]).toEqual({ entries: 2, balance: "60.00" });
      await db.query(`select public.add_khata_entry_idempotent('${shop}',
        '12121212-1212-4212-8212-121212121212', '${debtor}', 'received', 60, 'final')`);
      const fullyPaid = await db.query<{ entries: number; balance: string }>(`
        select count(*)::integer entries,
          sum(case when type = 'gave' then amount else -amount end)::text balance
        from public.khata_entries where shop_id = '${shop}' and customer_id = '${debtor}'
      `);
      expect(fullyPaid.rows[0]).toEqual({ entries: 3, balance: "0.00" });

      const supplier = (await db.query<{ id: string }>(`select id from public.suppliers
        where shop_id = '${shop}' and name = 'North Market Distributors'`)).rows[0].id;
      const directCustomer = (await db.query<{ customer_code: string }>(`insert into public.customers(shop_id, name)
        values ('${shop}', 'Direct Insert Customer') returning customer_code`)).rows[0];
      expect(directCustomer.customer_code).toMatch(/^VL-CU-\d{6}$/u);
      await expect(db.query("select public.next_customer_reference()")).rejects.toThrow(/permission denied/i);
      const stockBeforeOrders = (await db.query<{ current_stock: number }>(`select current_stock::integer
        from public.products where id = '${maggi.id}'`)).rows[0].current_stock;
      const createOrder = (key: string) => db.query<{ id: string }>(`select public.create_purchase_order_idempotent(
        '${shop}', '${key}', '${supplier}', '[{"productId":"${maggi.id}","quantity":3,"unitCost":12.5}]'::jsonb,
        'operating assistant test') id`);
      const [orderA, orderB] = await Promise.all([
        createOrder("13131313-1313-4313-8313-131313131313"),
        createOrder("14141414-1414-4414-8414-141414141414"),
      ]);
      const orderAId = orderA.rows[0].id;
      const orderBId = orderB.rows[0].id;
      const orderRows = await db.query<{ order_number: string; total_amount: string; status: string }>(`
        select order_number, total_amount::text, status from public.purchase_orders
        where id in ('${orderAId}', '${orderBId}') order by order_number
      `);
      expect(orderRows.rows).toHaveLength(2);
      expect(new Set(orderRows.rows.map((order) => order.order_number)).size).toBe(2);
      for (const order of orderRows.rows) expect(order.order_number).toMatch(/^VL-PO-\d{4}-\d{6}$/u);
      expect(orderRows.rows.map((order) => order.total_amount)).toEqual(["37.50", "37.50"]);
      const stockOnDraft = (await db.query<{ current_stock: number }>(`select current_stock::integer
        from public.products where id = '${maggi.id}'`)).rows[0].current_stock;
      expect(stockOnDraft).toBe(stockBeforeOrders);
      await db.query(`select public.transition_purchase_order_confirmed_idempotent(
        '${shop}', '15151515-1515-4515-8515-151515151515', '${orderAId}', 'draft', 'place')`);
      await db.query(`select public.transition_purchase_order_confirmed_idempotent(
        '${shop}', '16161616-1616-4616-8616-161616161616', '${orderAId}', 'placed', 'receive')`);
      const afterReceive = (await db.query<{ stock: number; status: string; history: number }>(`
        select p.current_stock::integer stock, o.status,
          (select count(*)::integer from public.purchase_order_status_history h
            where h.order_id = o.id and h.shop_id = o.shop_id) history
        from public.purchase_orders o join public.products p on p.id = '${maggi.id}' where o.id = '${orderAId}'
      `)).rows[0];
      expect(afterReceive).toEqual({ stock: stockBeforeOrders + 3, status: "received", history: 3 });
      await db.exec("reset role;");
      await expect(db.query(`update public.purchase_orders set order_number = 'VL-PO-2099-999999' where id = '${orderAId}'`)).rejects.toThrow(/immutable/i);

      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${other}';`);
      await expect(db.query(`select public.record_credit_sale_idempotent(
        '${shop}', '17171717-1717-4717-8717-171717171717', '${sameNameA}', null, '${items}'::jsonb)`)).rejects.toThrow(/not authorized/i);
      const hiddenOrders = await db.query<{ count: number }>(`select count(*)::integer count
        from public.purchase_orders where shop_id = '${shop}'`);
      expect(hiddenOrders.rows[0].count).toBe(0);
      const hiddenSales = await db.query<{ summary: { total: number; count: number } }>(`
        select public.get_shop_sales_summary('${shop}', '2000-01-01T00:00:00Z', '3000-01-01T00:00:00Z') summary
      `);
      expect(hiddenSales.rows[0].summary).toEqual({ total: 0, count: 0 });
    } finally {
      await db.close();
    }
  }, 45_000);
});
