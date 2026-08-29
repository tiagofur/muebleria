# #449 RLS query-plan evidence

Measured on 2026-08-29 against PostgreSQL 15 local integration infrastructure.
The repeatable proof is
`TestTenantRLS_CriticalCustomerPlanUsesTenantIndex`, using 10,002 customer rows
split evenly between two organizations and `EXPLAIN (ANALYZE, BUFFERS)`.

| Query | Role/barrier | Plan | Planning | Execution |
|---|---|---|---:|---:|
| `customers WHERE organization_id = $1` | schema owner, explicit scope baseline | `idx_customers_organization` index scan | 0.106 ms | 0.421 ms |
| same | non-owner runtime role + FORCE RLS | `idx_customers_organization` index scan + RLS filter | 0.530 ms | 1.411 ms |

Both plans read 5,001 rows with 67 shared-buffer hits. The RLS defense adds
approximately 0.99 ms in this deliberately broad half-table result while retaining
the organization-first index. This is evidence, not a production latency forecast.

Migration `000094` adds missing organization-first indexes across the inventory.
`VerifyRLSReadiness` rejects startup when any protected table with an
`organization_id` lacks such an index. The test fails if the critical customer
plan stops using `idx_customers_organization`.
