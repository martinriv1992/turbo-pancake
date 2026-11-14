import type { Db } from "@/lib/db";

export class BudgetError extends Error {}

type Scope = { org_id: string; brand_id: string; project_id: string | null; campaign_id: string | null };

/** Spend against each configured budget scope. A scope without a limit is omitted. */
export async function budgetStatus(db: Db, s: Scope) {
  const [r] = await db`
    select
      o.monthly_budget_usd as org_limit,
      (select coalesce(sum(amount_usd), 0) from production_costs c
        where c.org_id = o.id and c.created_at >= date_trunc('month', now())) as org_spent,
      b.monthly_budget_usd as brand_limit,
      (select coalesce(sum(amount_usd), 0) from production_costs c
        where c.brand_id = b.id and c.created_at >= date_trunc('month', now())) as brand_spent,
      (select budget_usd from projects where id = ${s.project_id}) as project_limit,
      (select coalesce(sum(amount_usd), 0) from production_costs c where c.project_id = ${s.project_id}) as project_spent,
      (select budget_usd from campaigns where id = ${s.campaign_id}) as campaign_limit,
      (select coalesce(sum(amount_usd), 0) from production_costs c where c.campaign_id = ${s.campaign_id}) as campaign_spent
    from organizations o join brands b on b.org_id = o.id
    where o.id = ${s.org_id} and b.id = ${s.brand_id}`;
  const scopes = [
    { scope: "organization (this month)", limit: r?.org_limit, spent: r?.org_spent },
    { scope: "brand (this month)", limit: r?.brand_limit, spent: r?.brand_spent },
    { scope: "project", limit: r?.project_limit, spent: r?.project_spent },
    { scope: "campaign", limit: r?.campaign_limit, spent: r?.campaign_spent },
  ];
  return scopes
    .filter((x) => x.limit != null)
    .map((x) => ({ scope: x.scope, limit: Number(x.limit), spent: Number(x.spent) }));
}

/** Throws when spending `amount` more would exceed any configured limit. Free work is never blocked. */
export async function assertWithinBudget(db: Db, s: Scope, amount: number) {
  if (amount <= 0) return;
  for (const b of await budgetStatus(db, s)) {
    if (b.spent + amount > b.limit) {
      throw new BudgetError(
        `Budget limit reached for the ${b.scope}: $${b.spent.toFixed(2)} spent of $${b.limit.toFixed(2)}, ` +
          `and this step is estimated at $${amount.toFixed(4)}.`,
      );
    }
  }
}
