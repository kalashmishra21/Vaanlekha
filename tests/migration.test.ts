import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("supabase/migrations/20261007000100_initial_business.sql", "utf8");
const hardeningMigration = readFileSync("supabase/migrations/20261008071313_hardening_indexes.sql", "utf8");
const demoMigration = readFileSync("supabase/migrations/20261008090000_demo_shop_reset.sql", "utf8");
const assistantMigration = readFileSync("supabase/migrations/20261008160000_assistant_open_khata.sql", "utf8");
const ordersMigration = readFileSync("supabase/migrations/20261008190000_suppliers_purchase_orders.sql", "utf8");
const orderIndexMigration = readFileSync("supabase/migrations/20261008190256_purchase_order_items_shop_index.sql", "utf8");
const stage13Migration = readFileSync("supabase/migrations/20261010090000_mutation_idempotency_and_rate_limits.sql", "utf8");
const clarificationMigration = readFileSync("supabase/migrations/20261010100000_assistant_pending_clarifications.sql", "utf8");
const transitionGuardMigration = readFileSync("supabase/migrations/20261010110000_order_transition_confirmation_guard.sql", "utf8");
const conversationMigration = readFileSync("supabase/migrations/20261010182851_assistant_conversations.sql", "utf8");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

describe("Supabase migration in local PostgreSQL", () => {
  it("seeds idempotently, enforces ownership, and rolls back failed sales", async () => {
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
      await db.exec(migration);
      await db.exec(hardeningMigration);
      await db.exec(demoMigration);
      await db.exec(assistantMigration);
      await db.exec(ordersMigration);
      await db.exec(orderIndexMigration);
      await db.exec(stage13Migration);
      await db.exec(clarificationMigration);
      await db.exec(transitionGuardMigration);
      await db.exec(conversationMigration);
      const orderItemShopIndex = await db.query<{ exists: boolean }>(`
        select exists (
          select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'purchase_order_items_shop_id_idx'
        )
      `);
      expect(orderItemShopIndex.rows[0].exists).toBe(true);
      const hardening = await db.query<{ function_executable: boolean; index_count: number }>(`
        select
          has_function_privilege('authenticated', 'public.create_profile_for_user()', 'EXECUTE') as function_executable,
          (select count(*)::integer from pg_indexes where schemaname = 'public' and indexname in (
            'ai_actions_shop_id_idx', 'inventory_movements_product_shop_idx',
            'khata_entries_customer_shop_idx', 'khata_entries_shop_created_idx',
            'sale_items_product_shop_idx', 'sale_items_sale_shop_idx', 'sale_items_shop_id_idx'
          )) as index_count
      `);
      expect(hardening.rows[0]).toEqual({ function_executable: false, index_count: 7 });
      const protectedTables = await db.query<{ rls: boolean; readable: boolean }>(`
        select c.relrowsecurity as rls,
          has_table_privilege('authenticated', c.oid, 'select') as readable
        from pg_class c
        where c.oid in ('public.business_idempotency'::regclass, 'public.api_rate_limit_windows'::regclass,
          'public.assistant_pending_clarifications'::regclass)
        order by c.relname
      `);
      expect(protectedTables.rows).toEqual([
        { rls: true, readable: false }, { rls: true, readable: false }, { rls: true, readable: false },
      ]);
      await db.exec(`
        grant usage on schema public, auth to authenticated;
        insert into auth.users(id, raw_user_meta_data) values
          ('${userId}', '{}'::jsonb), ('${otherId}', '{}'::jsonb);
        set role authenticated;
        set request.jwt.claim.sub = '${userId}';
      `);
      const first = await db.query<{ bootstrap_demo_shop: string }>("select public.bootstrap_demo_shop()");
      const shopId = first.rows[0].bootstrap_demo_shop;
      const again = await db.query<{ bootstrap_demo_shop: string }>("select public.bootstrap_demo_shop()");
      expect(again.rows[0].bootstrap_demo_shop).toBe(shopId);

      const createdThread = await db.query<{ id: string }>(`select public.create_assistant_conversation('${shopId}') id`);
      const threadId = createdThread.rows[0].id;
      const turnKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const reserved = await db.query<{ result: { status: string } }>(`select public.reserve_assistant_turn('${shopId}', '${threadId}', '${turnKey}', 'Aaj ki sale batao') result`);
      expect(reserved.rows[0].result.status).toBe("reserved");
      const duplicateBusy = await db.query<{ result: { status: string } }>(`select public.reserve_assistant_turn('${shopId}', '${threadId}', '${turnKey}', 'Aaj ki sale batao') result`);
      expect(duplicateBusy.rows[0].result.status).toBe("busy");
      await expect(db.query(`select public.reserve_assistant_turn('${shopId}', '${threadId}', '${turnKey}', 'Add stock')`)).rejects.toThrow();
      const completed = await db.query(`select public.complete_assistant_turn('${shopId}', '${threadId}', '${turnKey}',
        'Today''s sales are zero.', '{"state":"confirmed","title":"Sales","intent":"sales.getDailySummary","detail":"Count 0","reply":"Today''s sales are zero."}'::jsonb,
        '{"kind":"product-create-price","product":"Bread","unit":"packet","openingStock":50}'::jsonb, '${turnKey}')`);
      expect(completed.rows).toHaveLength(1);
      const replay = await db.query<{ result: { status: string; result: { reply: string } } }>(`select public.reserve_assistant_turn('${shopId}', '${threadId}', '${turnKey}', 'Aaj ki sale batao') result`);
      expect(replay.rows[0].result).toMatchObject({ status: "completed", result: { reply: "Today's sales are zero." } });
      const savedMessages = await db.query<{ count: number }>(`select count(*)::int count from public.assistant_messages where conversation_id = '${threadId}'`);
      expect(savedMessages.rows[0].count).toBe(2);
      const threadTwo = (await db.query<{ id: string }>(`select public.create_assistant_conversation('${shopId}') id`)).rows[0].id;
      const nextKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const threadOneNext = await db.query<{ result: { pending: { kind: string } } }>(`select public.reserve_assistant_turn('${shopId}', '${threadId}', '${nextKey}', 'Aaj ki sale batao') result`);
      const threadTwoNext = await db.query<{ result: { pending: unknown } }>(`select public.reserve_assistant_turn('${shopId}', '${threadTwo}', '${nextKey}', 'Aaj ki sale batao') result`);
      expect(threadOneNext.rows[0].result.pending.kind).toBe("product-create-price");
      expect(threadTwoNext.rows[0].result.pending).toBeNull();

      const clarificationKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      await db.query(`select public.save_assistant_pending_clarification('${shopId}', '{"kind":"product-create-price","product":"Bread","unit":"packet","openingStock":50}'::jsonb, '${clarificationKey}')`);
      const pending = await db.query<{ value: { pending: { product: string }; requestKey: string } }>(`select public.get_assistant_pending_clarification('${shopId}') value`);
      expect(pending.rows[0].value).toEqual({
        pending: { kind: "product-create-price", product: "Bread", unit: "packet", openingStock: 50 }, requestKey: clarificationKey,
      });
      await db.query(`select public.clear_assistant_pending_clarification('${shopId}')`);
      const cleared = await db.query<{ value: unknown }>(`select public.get_assistant_pending_clarification('${shopId}') value`);
      expect(cleared.rows[0].value).toBeNull();
      const seeded = await db.query<{ products: number; customers: number; sales: number; movements: number; entries: number; low_stock: number; outstanding: string }>(`
        select
          (select count(*)::integer from public.products where shop_id = '${shopId}') products,
          (select count(*)::integer from public.customers where shop_id = '${shopId}') customers,
          (select count(*)::integer from public.sales where shop_id = '${shopId}') sales,
          (select count(*)::integer from public.inventory_movements where shop_id = '${shopId}') movements,
          (select count(*)::integer from public.khata_entries where shop_id = '${shopId}') entries,
          (select count(*)::integer from public.products where shop_id = '${shopId}' and current_stock <= low_stock_threshold) low_stock,
          (select sum(case when type = 'gave' then amount else -amount end) from public.khata_entries where shop_id = '${shopId}') outstanding
      `);
      expect(seeded.rows[0]).toEqual({ products: 8, customers: 4, sales: 4, movements: 18, entries: 9, low_stock: 2, outstanding: "770.00" });
      const supplier = await db.query<{ id: string }>(`select id from public.suppliers where shop_id = '${shopId}' and name = 'North Market Distributors'`);
      expect(supplier.rows).toHaveLength(1);
      const knownProduct = await db.query<{ id: string }>(`select id from public.products where shop_id = '${shopId}' and name = 'Maggi'`);
      const milk = await db.query<{ id: string; current_stock: number }>(`select id,current_stock from public.products where shop_id = '${shopId}' and name = 'Amul Milk'`);
      const order = await db.query<{ create_purchase_order: string }>(`select public.create_purchase_order('${shopId}', '${supplier.rows[0].id}', '[{"productId":"${milk.rows[0].id}","quantity":12,"unitCost":null}]'::jsonb, 'QA reorder')`);
      const orderId = order.rows[0].create_purchase_order;
      const draftStock = await db.query<{ current_stock: number }>(`select current_stock from public.products where id = '${milk.rows[0].id}'`);
      expect(draftStock.rows[0].current_stock).toBe(milk.rows[0].current_stock);
      await expect(db.query(`select public.transition_purchase_order('${shopId}', '${orderId}', 'receive')`)).rejects.toThrow();
      await db.query(`select public.transition_purchase_order('${shopId}', '${orderId}', 'place')`);
      await db.query(`select public.transition_purchase_order('${shopId}', '${orderId}', 'receive')`);
      const received = await db.query<{ current_stock: number; movements: number; status: string }>(`
        select p.current_stock, (select count(*)::integer from public.inventory_movements where product_id = p.id and note = 'Purchase order ${orderId}') movements,
          (select status from public.purchase_orders where id = '${orderId}') status from public.products p where p.id = '${milk.rows[0].id}'
      `);
      expect(received.rows[0]).toEqual({ current_stock: milk.rows[0].current_stock + 12, movements: 1, status: "received" });
      await expect(db.query(`select public.transition_purchase_order('${shopId}', '${orderId}', 'receive')`)).rejects.toThrow();
      await expect(db.query(`select public.create_purchase_order('${shopId}', '${supplier.rows[0].id}', '[{"productId":"${milk.rows[0].id}","quantity":0,"unitCost":null}]'::jsonb, null)`)).rejects.toThrow();
      const countOrders = await db.query<{ count: number }>(`select count(*)::integer count from public.purchase_orders where shop_id = '${shopId}'`);
      expect(countOrders.rows[0].count).toBe(1);
      await expect(db.query(`insert into public.purchase_orders(shop_id,supplier_id) values ('${shopId}', '${supplier.rows[0].id}')`)).rejects.toThrow();
      await expect(db.query(`update public.purchase_orders set status = 'draft' where id = '${orderId}'`)).rejects.toThrow();
      await db.exec(`set request.jwt.claim.sub = '${otherId}';`);
      const hiddenThreads = await db.query<{ count: number }>(`select count(*)::int count from public.assistant_conversations where id = '${threadId}'`);
      const hiddenMessages = await db.query<{ count: number }>(`select count(*)::int count from public.assistant_messages where conversation_id = '${threadId}'`);
      expect(hiddenThreads.rows[0].count).toBe(0);
      expect(hiddenMessages.rows[0].count).toBe(0);
      await expect(db.query(`select public.reserve_assistant_turn('${shopId}', '${threadId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Add stock')`)).rejects.toThrow();
      for (const table of ["suppliers", "purchase_orders", "purchase_order_items"]) {
        const hidden = await db.query<{ count: number }>(`select count(*)::integer count from public.${table} where shop_id = '${shopId}'`);
        expect(hidden.rows[0].count).toBe(0);
      }
      await expect(db.query(`select public.transition_purchase_order('${shopId}', '${orderId}', 'cancel')`)).rejects.toThrow();
      await expect(db.query(`select public.adjust_stock_idempotent('${shopId}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${knownProduct.rows[0].id}', 1, 'Cross shop')`)).rejects.toThrow();
      await expect(db.query(`select public.consume_shop_rate_limit('${shopId}', 'assistant_turn')`)).rejects.toThrow();
      await db.exec(`set request.jwt.claim.sub = '';`);
      await expect(db.query(`select public.transition_purchase_order('${shopId}', '${orderId}', 'receive')`)).rejects.toThrow();
      await expect(db.query(`select public.consume_shop_rate_limit(null, 'assistant_turn')`)).rejects.toThrow();
      await db.exec(`set request.jwt.claim.sub = '${userId}';`);
      const opened = await db.query<{ open_khata_account: string }>(`select public.open_khata_account('${shopId}', 'Nandini', 100)`);
      const account = await db.query<{ entries: number; balance: string }>(`
        select count(*)::integer entries, sum(case when type = 'gave' then amount else -amount end) balance
        from public.khata_entries where shop_id = '${shopId}' and customer_id = '${opened.rows[0].open_khata_account}'
      `);
      expect(account.rows[0]).toEqual({ entries: 1, balance: "100.00" });
      await expect(db.query(`select public.open_khata_account('${shopId}', 'Nandini', 50)`)).rejects.toThrow();
      await expect(db.query(`select public.open_khata_account('${shopId}', 'Second Nandini', -10)`)).rejects.toThrow();
      const noPartialAccount = await db.query<{ count: number }>(`select count(*)::integer count from public.customers where shop_id = '${shopId}' and name = 'Second Nandini'`);
      expect(noPartialAccount.rows[0].count).toBe(0);
      const newProduct = await db.query<{ create_product: string }>(`select public.create_product('${shopId}', 'Test Tea', 'TST-001', 'packet', 25, 18, 3, 7)`);
      const opening = await db.query<{ current_stock: number; movements: number }>(`
        select p.current_stock,
          (select count(*)::integer from public.inventory_movements where product_id = p.id) movements
        from public.products p where p.id = '${newProduct.rows[0].create_product}'
      `);
      expect(opening.rows[0]).toEqual({ current_stock: 7, movements: 1 });
      await expect(db.query(`update public.products set archived_at = now() where id = '${newProduct.rows[0].create_product}'`)).rejects.toThrow();
      await db.query(`select public.adjust_stock('${shopId}', '${newProduct.rows[0].create_product}', -7, 'Clear stock')`);
      await db.query(`update public.products set archived_at = now() where id = '${newProduct.rows[0].create_product}'`);
      await expect(db.query(`select public.adjust_stock('${shopId}', '${newProduct.rows[0].create_product}', 1, 'Archived')`)).rejects.toThrow();

      const product = await db.query<{ id: string; current_stock: number }>(`select id, current_stock from public.products where shop_id = '${shopId}' and name = 'Maggi'`);
      const maggi = product.rows[0];
      expect(maggi.current_stock).toBe(46);
      await expect(db.query(`update public.products set current_stock = 999 where id = '${maggi.id}'`)).rejects.toThrow();
      await expect(db.query(`insert into public.sales(shop_id,total_amount) values ('${shopId}', 999)`)).rejects.toThrow();
      const adjusted = await db.query<{ adjust_stock: number }>(`select public.adjust_stock('${shopId}', '${maggi.id}', 20, 'Test')`);
      expect(adjusted.rows[0].adjust_stock).toBe(66);
      await expect(db.query(`select public.adjust_stock('${shopId}', '${maggi.id}', -999, 'Invalid')`)).rejects.toThrow();

      const beforeSale = await db.query<{ count: number }>(`select count(*)::integer as count from public.sales where shop_id = '${shopId}'`);
      await expect(db.query(`select public.record_sale('${shopId}', '[{"productId":"${maggi.id}","quantity":1000}]'::jsonb, 'cash')`)).rejects.toThrow();
      const afterSale = await db.query<{ count: number }>(`select count(*)::integer as count from public.sales where shop_id = '${shopId}'`);
      expect(afterSale.rows[0].count).toBe(beforeSale.rows[0].count);
      const successful = await db.query<{ record_sale: string }>(`select public.record_sale('${shopId}', '[{"productId":"${maggi.id}","quantity":2}]'::jsonb, 'upi')`);
      const saved = await db.query<{ total_amount: string }>(`select total_amount from public.sales where id = '${successful.rows[0].record_sale}'`);
      expect(Number(saved.rows[0].total_amount)).toBe(30);

      const stockKey = "33333333-3333-4333-8333-333333333333";
      const repeatedAdjustments = await Promise.all([
        db.query<{ adjust_stock_idempotent: number }>(`select public.adjust_stock_idempotent('${shopId}', '${stockKey}', '${maggi.id}', 3, 'Idempotency test')`),
        db.query<{ adjust_stock_idempotent: number }>(`select public.adjust_stock_idempotent('${shopId}', '${stockKey}', '${maggi.id}', 3, 'Idempotency test')`),
      ]);
      expect(repeatedAdjustments.map((result) => result.rows[0].adjust_stock_idempotent)).toEqual([67, 67]);
      const singleMovement = await db.query<{ count: number }>(`select count(*)::integer count from public.inventory_movements where product_id = '${maggi.id}' and note = 'Idempotency test'`);
      expect(singleMovement.rows[0].count).toBe(1);
      await expect(db.query(`select public.adjust_stock_idempotent('${shopId}', '${stockKey}', '${maggi.id}', 4, 'Conflicting payload')`)).rejects.toThrow();
      await expect(db.query(`select public.adjust_stock_idempotent('${shopId}', '44444444-4444-4444-8444-444444444444', '${maggi.id}', -999, 'Must roll back')`)).rejects.toThrow();
      await db.exec("reset role;");
      const rolledBackClaim = await db.query<{ count: number }>(`select count(*)::integer count from public.business_idempotency where request_key = '44444444-4444-4444-8444-444444444444'`);
      expect(rolledBackClaim.rows[0].count).toBe(0);
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);

      const saleKey = "55555555-5555-4555-8555-555555555555";
      const idempotentSale = await db.query<{ record_sale_idempotent: { saleId: string; total: number } }>(`select public.record_sale_idempotent('${shopId}', '${saleKey}', '[{"productId":"${maggi.id}","quantity":2}]'::jsonb, 'cash')`);
      const replayedSale = await db.query<{ record_sale_idempotent: { saleId: string; total: number } }>(`select public.record_sale_idempotent('${shopId}', '${saleKey}', '[{"productId":"${maggi.id}","quantity":2}]'::jsonb, 'cash')`);
      expect(replayedSale.rows[0].record_sale_idempotent).toEqual(idempotentSale.rows[0].record_sale_idempotent);
      const saleCount = await db.query<{ count: number; stock: number }>(`select (select count(*)::integer from public.sales where shop_id = '${shopId}') count, current_stock stock from public.products where id = '${maggi.id}' group by current_stock`);
      expect(saleCount.rows[0]).toEqual({ count: 6, stock: 65 });

      const customerKey = "66666666-6666-4666-8666-666666666666";
      const customerA = await db.query<{ create_customer_idempotent: string }>(`select public.create_customer_idempotent('${shopId}', '${customerKey}', 'Idempotent Customer', null)`);
      const customerB = await db.query<{ create_customer_idempotent: string }>(`select public.create_customer_idempotent('${shopId}', '${customerKey}', 'Idempotent Customer', null)`);
      expect(customerB.rows[0].create_customer_idempotent).toBe(customerA.rows[0].create_customer_idempotent);
      await expect(db.query(`select public.create_customer_idempotent('${shopId}', '${customerKey}', 'Different Name', null)`)).rejects.toThrow();

      const productKey = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      const productA = await db.query<{ create_product_idempotent: string }>(`select public.create_product_idempotent('${shopId}', '${productKey}', 'Idempotent Product', 'IDEMP-01', 'packet', 12, 8, 3, 2)`);
      const productB = await db.query<{ create_product_idempotent: string }>(`select public.create_product_idempotent('${shopId}', '${productKey}', 'Idempotent Product', 'IDEMP-01', 'packet', 12, 8, 3, 2)`);
      expect(productB.rows[0].create_product_idempotent).toBe(productA.rows[0].create_product_idempotent);
      const productRows = await db.query<{ products: number; movements: number; stock: number }>(`select (select count(*)::integer from public.products where id = '${productA.rows[0].create_product_idempotent}') products, (select count(*)::integer from public.inventory_movements where product_id = '${productA.rows[0].create_product_idempotent}') movements, current_stock stock from public.products where id = '${productA.rows[0].create_product_idempotent}'`);
      expect(productRows.rows[0]).toEqual({ products: 1, movements: 1, stock: 2 });

      const openedKey = "77777777-7777-4777-8777-777777777777";
      const openedA = await db.query<{ open_khata_account_idempotent: string }>(`select public.open_khata_account_idempotent('${shopId}', '${openedKey}', 'Idempotent Khata', 125)`);
      const openedB = await db.query<{ open_khata_account_idempotent: string }>(`select public.open_khata_account_idempotent('${shopId}', '${openedKey}', 'Idempotent Khata', 125)`);
      expect(openedB.rows[0].open_khata_account_idempotent).toBe(openedA.rows[0].open_khata_account_idempotent);
      const openingRows = await db.query<{ customers: number; entries: number; balance: string }>(`select (select count(*)::integer from public.customers where id = '${openedA.rows[0].open_khata_account_idempotent}') customers, count(*)::integer entries, sum(amount)::text balance from public.khata_entries where customer_id = '${openedA.rows[0].open_khata_account_idempotent}'`);
      expect(openingRows.rows[0]).toEqual({ customers: 1, entries: 1, balance: "125.00" });

      const khataKey = "88888888-8888-4888-8888-888888888888";
      await Promise.all([
        db.query(`select public.add_khata_entry_idempotent('${shopId}', '${khataKey}', '${openedA.rows[0].open_khata_account_idempotent}', 'received', 25, 'Idempotency payment')`),
        db.query(`select public.add_khata_entry_idempotent('${shopId}', '${khataKey}', '${openedA.rows[0].open_khata_account_idempotent}', 'received', 25, 'Idempotency payment')`),
      ]);
      const khataRows = await db.query<{ entries: number; balance: string }>(`select count(*)::integer entries, sum(case when type = 'gave' then amount else -amount end)::text balance from public.khata_entries where customer_id = '${openedA.rows[0].open_khata_account_idempotent}'`);
      expect(khataRows.rows[0]).toEqual({ entries: 2, balance: "100.00" });

      const orderKey = "99999999-9999-4999-8999-999999999999";
      const createdOrderA = await db.query<{ create_purchase_order_idempotent: string }>(`select public.create_purchase_order_idempotent('${shopId}', '${orderKey}', '${supplier.rows[0].id}', '[{"productId":"${milk.rows[0].id}","quantity":5,"unitCost":null}]'::jsonb, 'Idempotent order')`);
      const createdOrderB = await db.query<{ create_purchase_order_idempotent: string }>(`select public.create_purchase_order_idempotent('${shopId}', '${orderKey}', '${supplier.rows[0].id}', '[{"productId":"${milk.rows[0].id}","quantity":5,"unitCost":null}]'::jsonb, 'Idempotent order')`);
      expect(createdOrderB.rows[0].create_purchase_order_idempotent).toBe(createdOrderA.rows[0].create_purchase_order_idempotent);
      const placedKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await db.query(`select public.transition_purchase_order_idempotent('${shopId}', '${placedKey}', '${createdOrderA.rows[0].create_purchase_order_idempotent}', 'place')`);
      await db.query(`select public.transition_purchase_order_idempotent('${shopId}', '${placedKey}', '${createdOrderA.rows[0].create_purchase_order_idempotent}', 'place')`);
      const receivedKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await db.query(`select public.transition_purchase_order_idempotent('${shopId}', '${receivedKey}', '${createdOrderA.rows[0].create_purchase_order_idempotent}', 'receive')`);
      await db.query(`select public.transition_purchase_order_idempotent('${shopId}', '${receivedKey}', '${createdOrderA.rows[0].create_purchase_order_idempotent}', 'receive')`);
      const stockAfterReceive = await db.query<{ stock: number; movements: number; status: string }>(`select p.current_stock stock, (select count(*)::integer from public.inventory_movements where product_id = p.id and note = 'Purchase order ${createdOrderA.rows[0].create_purchase_order_idempotent}') movements, (select status from public.purchase_orders where id = '${createdOrderA.rows[0].create_purchase_order_idempotent}') status from public.products p where id = '${milk.rows[0].id}'`);
      expect(stockAfterReceive.rows[0]).toEqual({ stock: milk.rows[0].current_stock + 17, movements: 1, status: "received" });
      await expect(db.query(`select public.transition_purchase_order_idempotent('${shopId}', '${placedKey}', '${createdOrderA.rows[0].create_purchase_order_idempotent}', 'receive')`)).rejects.toThrow();

      const guardedDraft = await db.query<{ create_purchase_order_idempotent: string }>(`select public.create_purchase_order_idempotent('${shopId}', '12121212-1212-4212-8212-121212121212', '${supplier.rows[0].id}', '[{"productId":"${milk.rows[0].id}","quantity":3,"unitCost":null}]'::jsonb, 'Confirmed status test')`);
      const guardedOrderId = guardedDraft.rows[0].create_purchase_order_idempotent;
      const guardedPlaceKey = "13131313-1313-4313-8313-131313131313";
      const placeCall = `select public.transition_purchase_order_confirmed_idempotent('${shopId}', '${guardedPlaceKey}', '${guardedOrderId}', 'draft', 'place')`;
      await db.query(placeCall);
      await db.query(placeCall);
      await expect(db.query(`select public.transition_purchase_order_confirmed_idempotent('${shopId}', '14141414-1414-4414-8414-141414141414', '${guardedOrderId}', 'draft', 'receive')`)).rejects.toThrow();
      const stillPlaced = await db.query<{ status: string; stock: number }>(`select o.status, p.current_stock stock from public.purchase_orders o join public.purchase_order_items i on i.order_id = o.id join public.products p on p.id = i.product_id where o.id = '${guardedOrderId}'`);
      expect(stillPlaced.rows[0]).toEqual({ status: "placed", stock: milk.rows[0].current_stock + 17 });
      const guardedReceiveKey = "15151515-1515-4515-8515-151515151515";
      const receiveCall = `select public.transition_purchase_order_confirmed_idempotent('${shopId}', '${guardedReceiveKey}', '${guardedOrderId}', 'placed', 'receive')`;
      await db.query(receiveCall);
      await db.query(receiveCall);
      const receivedOnce = await db.query<{ status: string; stock: number; movements: number }>(`select o.status, p.current_stock stock, (select count(*)::integer from public.inventory_movements where note = 'Purchase order ${guardedOrderId}') movements from public.purchase_orders o join public.purchase_order_items i on i.order_id = o.id join public.products p on p.id = i.product_id where o.id = '${guardedOrderId}'`);
      expect(receivedOnce.rows[0]).toEqual({ status: "received", stock: milk.rows[0].current_stock + 20, movements: 1 });

      const concurrentLimits = await Promise.all(Array.from({ length: 25 }, () => db.query<{ allowed: boolean }>(`select allowed from public.consume_shop_rate_limit('${shopId}', 'assistant_turn')`)));
      expect(concurrentLimits.filter((result) => result.rows[0].allowed)).toHaveLength(20);
      expect(concurrentLimits.filter((result) => !result.rows[0].allowed)).toHaveLength(5);

      const supplierKey = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      const supplierA = await db.query<{ create_supplier_idempotent: string }>(`select public.create_supplier_idempotent('${shopId}', '${supplierKey}', 'Idempotent Supplier', null, null)`);
      const supplierB = await db.query<{ create_supplier_idempotent: string }>(`select public.create_supplier_idempotent('${shopId}', '${supplierKey}', 'Idempotent Supplier', null, null)`);
      expect(supplierB.rows[0].create_supplier_idempotent).toBe(supplierA.rows[0].create_supplier_idempotent);
      await expect(db.query(`select public.create_supplier_idempotent('${shopId}', '${supplierKey}', 'Different Supplier', null, null)`)).rejects.toThrow();

      const reset = await db.query<{ reset_demo_shop: string }>("select public.reset_demo_shop()");
      const resetShopId = reset.rows[0].reset_demo_shop;
      expect(resetShopId).not.toBe(shopId);
      const fresh = await db.query<{ products: number; sales: number; stock: number }>(`
        select (select count(*)::integer from public.products where shop_id = '${resetShopId}') products,
          (select count(*)::integer from public.sales where shop_id = '${resetShopId}') sales,
          (select current_stock from public.products where shop_id = '${resetShopId}' and name = 'Maggi') stock
      `);
      expect(fresh.rows[0]).toEqual({ products: 8, sales: 4, stock: 46 });

      await db.exec(`set request.jwt.claim.sub = '${otherId}';`);
      const hidden = await db.query<{ count: number }>(`select count(*)::integer as count from public.products where shop_id = '${resetShopId}'`);
      expect(hidden.rows[0].count).toBe(0);
      const hiddenSuppliers = await db.query<{ count: number }>(`select count(*)::integer count from public.suppliers where shop_id = '${resetShopId}'`);
      expect(hiddenSuppliers.rows[0].count).toBe(0);
      await expect(db.query(`select public.create_purchase_order('${resetShopId}', '${supplier.rows[0].id}', '[]'::jsonb, null)`)).rejects.toThrow();
      await expect(db.query(`select public.reset_demo_shop()`)).rejects.toThrow();
      await expect(db.query(`select public.adjust_stock('${resetShopId}', (select id from public.products where shop_id = '${resetShopId}' limit 1), 1, 'Cross shop')`)).rejects.toThrow();
      await expect(db.query(`select public.open_khata_account('${resetShopId}', 'Unauthorized', 50)`)).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 30000);
});
