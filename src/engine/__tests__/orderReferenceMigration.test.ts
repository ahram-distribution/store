import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Regression guard: Order Details must show the SAME reference number as the
// Order Card (الرقم المرجعى) — both read `o.reference_number` from `orders`.
//
// The singular RPC get_unified_order (used by OrderDetailPage) previously
// dropped the field when the order jsonb_build_object hit PostgreSQL's 100-arg
// limit, while the plural RPC get_unified_orders (used by the Orders list)
// kept it. This test pins the SQL contract so the two RPCs stay in parity.
// ---------------------------------------------------------------------------

const MIGRATIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations')

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_ROOT).filter((f) => f.endsWith('.sql')).sort()
}

function newestDefiningFile(fnRe: RegExp): { file: string; body: string } {
  const file = migrationFiles()
    .map((f) => ({ file: f, body: readFileSync(join(MIGRATIONS_ROOT, f), 'utf8') }))
    .filter(({ body }) => fnRe.test(body))
    .pop()!
  assert.ok(file, 'expected at least one migration defining the RPC')
  return file
}

describe('get_unified_order reference number contract', () => {
  it('singular RPC (Order Details) exposes the authoritative orders.reference_number column', () => {
    const { file, body } = newestDefiningFile(/CREATE OR REPLACE FUNCTION public\.get_unified_order\(/)
    const end = body.indexOf('$function$;')
    const fnBody = end === -1 ? body : body.slice(0, end)

    const orderRegion = fnBody.slice(fnBody.indexOf("'order', "), fnBody.indexOf("'customer',"))
    assert.ok(
      orderRegion.includes("'reference_number', o.reference_number"),
      `get_unified_order in ${file} must expose 'reference_number', o.reference_number on the order object`,
    )

    assert.ok(
      orderRegion.includes('|| jsonb_build_object('),
      `get_unified_order in ${file} must split the order jsonb_build_object with || (Postgres 100-arg limit)`,
    )
  })

  it('plural RPC (Orders list) keeps exposing the same authoritative orders.reference_number column', () => {
    const { file, body } = newestDefiningFile(/CREATE OR REPLACE FUNCTION public\.get_unified_orders\(/)
    assert.ok(
      body.includes("'reference_number', o.reference_number"),
      `get_unified_orders in ${file} must keep 'reference_number', o.reference_number`,
    )
  })

  it('reference_number is read from the orders table (never computed) on both RPCs', () => {
    const detail = newestDefiningFile(/CREATE OR REPLACE FUNCTION public\.get_unified_order\(/)
    const list = newestDefiningFile(/CREATE OR REPLACE FUNCTION public\.get_unified_orders\(/)
    for (const { file, body } of [detail, list]) {
      const end = body.indexOf('$function$;')
      const fnBody = end === -1 ? body : body.slice(0, end)
      const orderRef = fnBody.match(/'reference_number', o\.reference_number/)
      assert.ok(orderRef, `${file} must read o.reference_number from the orders row`)
      assert.ok(
        !/ORD-\d{4}-/.test(orderRef![0]),
        `${file} must not hardcode/generate a reference number`,
      )
    }
  })
})